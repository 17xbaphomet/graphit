"""Graphit drawing engine for ComfyUI (numpy + PIL)."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from PIL import Image, ImageDraw, ImageFont

DX = np.array([-1, 0, 1, -1, 1, -1, 0, 1], dtype=np.int32)
DY = np.array([-1, -1, -1, 0, 0, 1, 1, 1], dtype=np.int32)
RING = ((0, -1), (1, -1), (1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0), (-1, -1))
LINE_MARK_MAX = 158
PAPER = (243, 238, 228)


@dataclass
class Params:
    max_size: int = 680
    edge_threshold: float = 16
    ink_threshold: int = 38
    include_ink: bool = True
    min_stroke: int = 3
    levels: int = 10
    line_ms: int = 4800
    tone_ms: int = 7200
    hold_ms: int = 1600
    transparency: float = 100


@dataclass
class Job:
    width: int
    height: int
    rgba: np.ndarray
    gray: np.ndarray
    line_order: np.ndarray
    tone_order: np.ndarray
    paper: tuple[int, int, int]


@dataclass
class Plate:
    name: str
    kind: str
    frame: dict
    start_ms: int
    params: Params
    job: Job
    text: dict | None = None


def _to_gray(rgb: np.ndarray) -> np.ndarray:
    r = rgb[..., 0].astype(np.float32)
    g = rgb[..., 1].astype(np.float32)
    b = rgb[..., 2].astype(np.float32)
    return np.clip(0.2126 * r + 0.7152 * g + 0.0722 * b, 0, 255).astype(np.uint8)


def _box_blur3(src: np.ndarray, w: int, h: int) -> np.ndarray:
    img = src.reshape(h, w).astype(np.int32)
    pad = np.pad(img, 1, mode="edge")
    acc = (
        pad[:-2, :-2]
        + pad[:-2, 1:-1]
        + pad[:-2, 2:]
        + pad[1:-1, :-2]
        + pad[1:-1, 1:-1]
        + pad[1:-1, 2:]
        + pad[2:, :-2]
        + pad[2:, 1:-1]
        + pad[2:, 2:]
    )
    return (acc // 9).astype(np.uint8).reshape(-1)


def _sobel_mag(gray: np.ndarray, w: int, h: int) -> np.ndarray:
    g = gray.reshape(h, w).astype(np.int32)
    mag = np.zeros((h, w), dtype=np.float32)
    a = g[:-2, :-2]
    b = g[:-2, 1:-1]
    c = g[:-2, 2:]
    d = g[1:-1, :-2]
    f = g[1:-1, 2:]
    gv = g[2:, :-2]
    hv = g[2:, 1:-1]
    j = g[2:, 2:]
    gx = -a + c - 2 * d + 2 * f - gv + j
    gy = -a - 2 * b - c + gv + 2 * hv + j
    mag[1:-1, 1:-1] = np.hypot(gx, gy)
    return mag.reshape(-1)


def _non_max_edge(gray: np.ndarray, mag: np.ndarray, w: int, h: int, cut: float) -> np.ndarray:
    g = gray.reshape(h, w).astype(np.int32)
    m = mag.reshape(h, w)
    out = np.zeros((h, w), dtype=np.uint8)
    a = g[:-2, :-2]
    b = g[:-2, 1:-1]
    c = g[:-2, 2:]
    d = g[1:-1, :-2]
    f = g[1:-1, 2:]
    gv = g[2:, :-2]
    hv = g[2:, 1:-1]
    j = g[2:, 2:]
    gx = -a + c - 2 * d + 2 * f - gv + j
    gy = -a - 2 * b - c + gv + 2 * hv + j
    ax = np.abs(gx)
    ay = np.abs(gy)
    mid = m[1:-1, 1:-1]
    n1 = np.empty_like(mid)
    n2 = np.empty_like(mid)
    horiz = ax > ay * 2
    vert = (~horiz) & (ay > ax * 2)
    diag_pos = (~horiz) & (~vert) & (gx * gy > 0)
    diag_neg = ~(horiz | vert | diag_pos)
    n1[horiz] = m[1:-1, :-2][horiz]
    n2[horiz] = m[1:-1, 2:][horiz]
    n1[vert] = m[:-2, 1:-1][vert]
    n2[vert] = m[2:, 1:-1][vert]
    n1[diag_pos] = m[:-2, :-2][diag_pos]
    n2[diag_pos] = m[2:, 2:][diag_pos]
    n1[diag_neg] = m[:-2, 2:][diag_neg]
    n2[diag_neg] = m[2:, :-2][diag_neg]
    keep = (mid >= cut) & (mid >= n1) & (mid >= n2)
    out[1:-1, 1:-1] = keep.astype(np.uint8)
    return out.reshape(-1)


def thin_mask(mask: np.ndarray, w: int, h: int) -> np.ndarray:
    img = mask.reshape(h, w).copy()
    changed = True
    for _ in range(48):
        if not changed:
            break
        changed = False
        for step in (0, 1):
            kill = []
            ys, xs = np.nonzero(img[1:-1, 1:-1])
            ys = ys + 1
            xs = xs + 1
            for y, x in zip(ys.tolist(), xs.tolist()):
                p = []
                black = 0
                for dx, dy in RING:
                    v = 1 if img[y + dy, x + dx] else 0
                    p.append(v)
                    black += v
                if black < 2 or black > 6:
                    continue
                trans = 0
                for k in range(8):
                    if p[k] == 0 and p[(k + 1) & 7] == 1:
                        trans += 1
                if trans != 1:
                    continue
                if step == 0:
                    if p[0] * p[2] * p[4]:
                        continue
                    if p[2] * p[4] * p[6]:
                        continue
                else:
                    if p[0] * p[2] * p[6]:
                        continue
                    if p[0] * p[4] * p[6]:
                        continue
                kill.append((y, x))
            if kill:
                changed = True
                for y, x in kill:
                    img[y, x] = 0
    return img.reshape(-1)


def _snap_mask_to_dark(mask: np.ndarray, gray: np.ndarray, w: int, h: int, pale: int) -> np.ndarray:
    out = np.zeros_like(mask)
    idx = np.nonzero(mask)[0]
    for i in idx.tolist():
        if gray[i] <= pale:
            out[i] = 1
            continue
        x = i % w
        y = i // w
        best = i
        best_g = int(gray[i])
        for d in range(8):
            xx = x + int(DX[d])
            yy = y + int(DY[d])
            if xx < 0 or yy < 0 or xx >= w or yy >= h:
                continue
            j = yy * w + xx
            gj = int(gray[j])
            if gj < best_g:
                best_g = gj
                best = j
        if best_g < int(gray[i]):
            out[best] = 1
    return out


def _is_dark_contour(gray: np.ndarray, i: int, w: int, h: int, ink_cut: int) -> bool:
    if gray[i] > ink_cut:
        return False
    x = i % w
    y = i // w
    for d in range(8):
        xx = x + int(DX[d])
        yy = y + int(DY[d])
        if xx < 0 or yy < 0 or xx >= w or yy >= h:
            continue
        if gray[yy * w + xx] > ink_cut + 28:
            return True
    return False


def _prune_isolated(mask: np.ndarray, w: int, h: int) -> np.ndarray:
    out = mask.copy()
    idx = np.nonzero(mask)[0]
    for i in idx.tolist():
        x = i % w
        y = i // w
        n = 0
        for d in range(8):
            xx = x + int(DX[d])
            yy = y + int(DY[d])
            if 0 <= xx < w and 0 <= yy < h and mask[yy * w + xx]:
                n += 1
        if n == 0:
            out[i] = 0
    return out


def _neighbor_count(mask: np.ndarray, i: int, w: int, h: int) -> int:
    x = i % w
    y = i // w
    n = 0
    for d in range(8):
        xx = x + int(DX[d])
        yy = y + int(DY[d])
        if 0 <= xx < w and 0 <= yy < h and mask[yy * w + xx]:
            n += 1
    return n


def _pick_next(mask, visited, cur, prev_dx, prev_dy, w, h) -> int:
    x = cur % w
    y = cur // w
    best = -1
    best_score = -1e9
    for d in range(8):
        xx = x + int(DX[d])
        yy = y + int(DY[d])
        if xx < 0 or yy < 0 or xx >= w or yy >= h:
            continue
        j = yy * w + xx
        if not mask[j] or visited[j]:
            continue
        ndx = int(DX[d])
        ndy = int(DY[d])
        align = prev_dx * ndx + prev_dy * ndy
        cardinal = 0.2 if d in (1, 3, 4, 6) else 0
        score = align * 2 + cardinal
        if score > best_score:
            best_score = score
            best = j
    return best


def trace_strokes(mask: np.ndarray, w: int, h: int) -> list[list[int]]:
    n = w * h
    visited = np.zeros(n, dtype=np.uint8)
    pixels = np.nonzero(mask)[0].tolist()
    endpoints = [i for i in pixels if _neighbor_count(mask, i, w, h) <= 1]
    strokes: list[list[int]] = []

    def walk(start: int) -> None:
        stroke: list[int] = []
        cur = start
        prev_dx = 0
        prev_dy = 0
        while cur >= 0 and not visited[cur]:
            visited[cur] = 1
            stroke.append(cur)
            cx = cur % w
            cy = cur // w
            nxt = _pick_next(mask, visited, cur, prev_dx, prev_dy, w, h)
            if nxt >= 0:
                prev_dx = (nxt % w) - cx
                prev_dy = (nxt // w) - cy
            cur = nxt
        if stroke:
            strokes.append(stroke)

    for ep in endpoints:
        if not visited[ep]:
            walk(ep)
    for i in pixels:
        if not visited[i]:
            walk(i)
    return strokes


def flatten_strokes(
    strokes: list[list[int]],
    w: int,
    min_len: int = 3,
    start_x: int | None = None,
    start_y: int | None = None,
) -> np.ndarray:
    items = [s for s in strokes if len(s) >= min_len]
    if not items:
        return np.zeros(0, dtype=np.int32)
    used = [False] * len(items)
    starts = [(s[0] % w, s[0] // w) for s in items]
    ends = [(s[-1] % w, s[-1] // w) for s in items]

    def pick(px: int, py: int) -> tuple[int, bool]:
        best = -1
        best_d = 1e15
        reverse = False
        for i, s in enumerate(items):
            if used[i]:
                continue
            sx, sy = starts[i]
            ex, ey = ends[i]
            da = (sx - px) ** 2 + (sy - py) ** 2
            db = (ex - px) ** 2 + (ey - py) ** 2
            bias = 1 / (1 + len(s) * 0.0015)
            if da * bias < best_d:
                best_d = da * bias
                best = i
                reverse = False
            if db * bias < best_d:
                best_d = db * bias
                best = i
                reverse = True
        return best, reverse

    order: list[int] = []
    if start_x is not None and start_y is not None:
        idx, rev = pick(start_x, start_y)
    else:
        idx = int(np.argmax([len(s) for s in items]))
        rev = False
    for step in range(len(items)):
        if step > 0:
            last = order[-1]
            idx, rev = pick(last % w, last // w)
        if idx < 0:
            break
        s = list(reversed(items[idx])) if rev else items[idx]
        used[idx] = True
        order.extend(s)
    return np.array(order, dtype=np.int32)


def _label_components(mask: np.ndarray, w: int, h: int) -> np.ndarray:
    labels = np.full(mask.shape[0], -1, dtype=np.int32)
    cid = 0
    for seed in range(mask.shape[0]):
        if not mask[seed] or labels[seed] >= 0:
            continue
        stack = [seed]
        labels[seed] = cid
        while stack:
            cur = stack.pop()
            x = cur % w
            y = cur // w
            for d in range(8):
                xx = x + int(DX[d])
                yy = y + int(DY[d])
                if xx < 0 or yy < 0 or xx >= w or yy >= h:
                    continue
                j = yy * w + xx
                if not mask[j] or labels[j] >= 0:
                    continue
                labels[j] = cid
                stack.append(j)
        cid += 1
    return labels


def flatten_connected(
    strokes: list[list[int]],
    mask: np.ndarray,
    w: int,
    h: int,
    min_len: int = 3,
) -> np.ndarray:
    if not strokes:
        return np.zeros(0, dtype=np.int32)
    labels = _label_components(mask, w, h)
    groups: dict[int, list[list[int]]] = {}
    for stroke in strokes:
        lab = int(labels[stroke[0]])
        groups.setdefault(lab, []).append(stroke)
    ranked = sorted(groups.values(), key=lambda g: -sum(len(s) for s in g))
    ranked = [g for g in ranked if sum(len(s) for s in g) >= min_len]
    if not ranked:
        return np.zeros(0, dtype=np.int32)
    parts = []
    sx = sy = None
    used = [False] * len(ranked)
    for n in range(len(ranked)):
        pick = 0 if n == 0 and sx is None else -1
        if pick < 0:
            best_d = 1e15
            px, py = sx or 0, sy or 0
            for i, g in enumerate(ranked):
                if used[i]:
                    continue
                d = 1e15
                for s in g:
                    a, b = s[0], s[-1]
                    da = (a % w - px) ** 2 + (a // w - py) ** 2
                    db = (b % w - px) ** 2 + (b // w - py) ** 2
                    d = min(d, da, db)
                if d < best_d:
                    best_d = d
                    pick = i
        if pick < 0:
            break
        used[pick] = True
        part = flatten_strokes(ranked[pick], w, min_len=1, start_x=sx, start_y=sy)
        parts.append(part)
        if part.size:
            last = int(part[-1])
            sx, sy = last % w, last // w
    if not parts:
        return np.zeros(0, dtype=np.int32)
    return np.concatenate(parts)


def _dilate_dark(mask, gray, w, h, radius, dark_max) -> np.ndarray:
    out = mask.copy()
    r2 = radius * radius
    for i in np.nonzero(mask)[0].tolist():
        x, y = i % w, i // w
        for dy in range(-radius, radius + 1):
            yy = y + dy
            if yy < 0 or yy >= h:
                continue
            for dx in range(-radius, radius + 1):
                if dx * dx + dy * dy > r2:
                    continue
                xx = x + dx
                if xx < 0 or xx >= w:
                    continue
                j = yy * w + xx
                if gray[j] <= dark_max:
                    out[j] = 1
    return out


def _bridge_dark(mask, gray, w, h, gap, dark_max) -> np.ndarray:
    out = mask.copy()
    for i in np.nonzero(mask)[0].tolist():
        x, y = i % w, i // w
        for dy in range(-gap, gap + 1):
            for dx in range(-gap, gap + 1):
                if abs(dx) <= 1 and abs(dy) <= 1:
                    continue
                xx, yy = x + dx, y + dy
                if xx < 0 or yy < 0 or xx >= w or yy >= h:
                    continue
                if not mask[yy * w + xx]:
                    continue
                steps = max(abs(dx), abs(dy))
                ok = True
                for s in range(1, steps):
                    px = x + round(dx * s / steps)
                    py = y + round(dy * s / steps)
                    if gray[py * w + px] > dark_max:
                        ok = False
                        break
                if not ok:
                    continue
                for s in range(1, steps):
                    px = x + round(dx * s / steps)
                    py = y + round(dy * s / steps)
                    out[py * w + px] = 1
    return out


def expand_line_body(order, gray, w, h, radius, dark_max) -> np.ndarray:
    if order.size == 0:
        return order
    used = np.zeros(gray.shape[0], dtype=np.uint8)
    out: list[int] = []
    r2 = radius * radius
    for i in order.tolist():
        x, y = i % w, i // w
        js: list[int] = []
        ds: list[int] = []
        for dy in range(-radius, radius + 1):
            yy = y + dy
            if yy < 0 or yy >= h:
                continue
            for dx in range(-radius, radius + 1):
                if dx * dx + dy * dy > r2:
                    continue
                xx = x + dx
                if xx < 0 or xx >= w:
                    continue
                j = yy * w + xx
                if used[j] or gray[j] > dark_max:
                    continue
                used[j] = 1
                js.append(j)
                ds.append(dx * dx + dy * dy)
        paired = sorted(zip(ds, js))
        out.extend(j for _, j in paired)
    return np.array(out, dtype=np.int32)


def _order_mask(mask, w, h, sx=None, sy=None) -> np.ndarray:
    return flatten_strokes(trace_strokes(mask, w, h), w, min_len=1, start_x=sx, start_y=sy)


def build_tone_order(gray, w, h, levels, sx=None, sy=None) -> np.ndarray:
    bins: list[list[int]] = [[] for _ in range(levels)]
    for i, v in enumerate(gray.tolist()):
        bins[min(levels - 1, (v * levels) >> 8)].append(i)
    parts = []
    for pix in bins:
        if not pix:
            continue
        mask = np.zeros(gray.shape[0], dtype=np.uint8)
        mask[np.array(pix, dtype=np.int32)] = 1
        ordered = _order_mask(mask, w, h, sx, sy)
        parts.append(ordered)
        if ordered.size:
            last = int(ordered[-1])
            sx, sy = last % w, last // w
    if not parts:
        return np.zeros(0, dtype=np.int32)
    return np.concatenate(parts)


def analyze_rgb(rgb: np.ndarray, params: Params) -> Job:
    h, w = rgb.shape[:2]
    rgba = np.dstack([rgb, np.full((h, w), 255, dtype=np.uint8)]).reshape(-1, 4)
    gray = _to_gray(rgb).reshape(-1)
    blurred = _box_blur3(gray, w, h)
    mag = _sobel_mag(blurred, w, h)
    cut = (params.edge_threshold / 100.0) * float(max(1.0, mag.max()))
    ink_cut = params.ink_threshold if params.include_ink else -1
    ridge = _non_max_edge(blurred, mag, w, h, cut)
    raw = np.zeros(w * h, dtype=np.uint8)
    for i in range(w * h):
        edge = ridge[i] == 1
        ink = ink_cut >= 0 and _is_dark_contour(gray, i, w, h, ink_cut)
        if edge or ink:
            raw[i] = 1
    skeleton = thin_mask(
        _snap_mask_to_dark(
            thin_mask(_prune_isolated(raw, w, h), w, h),
            gray,
            w,
            h,
            132,
        ),
        w,
        h,
    )
    bridged = thin_mask(_bridge_dark(skeleton, gray, w, h, 2, LINE_MARK_MAX), w, h)
    cluster = _dilate_dark(bridged, gray, w, h, 2, LINE_MARK_MAX)
    strokes = trace_strokes(bridged, w, h)
    spine = flatten_connected(strokes, cluster, w, h, min_len=max(1, params.min_stroke))
    radius = max(2, min(4, round(max(w, h) / 420)))
    line_order = expand_line_body(spine, gray, w, h, radius, LINE_MARK_MAX)
    sx = sy = None
    if line_order.size:
        last = int(line_order[-1])
        sx, sy = last % w, last // w
    tone_order = build_tone_order(gray, w, h, params.levels, sx, sy)
    paper_i = int(np.argmax(gray))
    paper = (int(rgba[paper_i, 0]), int(rgba[paper_i, 1]), int(rgba[paper_i, 2]))
    return Job(w, h, rgba, gray, line_order, tone_order, paper)


def resize_max(rgb: np.ndarray, max_size: int) -> np.ndarray:
    h, w = rgb.shape[:2]
    scale = min(1.0, max_size / max(w, h))
    nw = max(1, round(w * scale))
    nh = max(1, round(h * scale))
    if nw == w and nh == h:
        return rgb
    img = Image.fromarray(rgb, mode="RGB")
    return np.asarray(img.resize((nw, nh), Image.Resampling.LANCZOS), dtype=np.uint8)


def _ease(x: float) -> float:
    t = 0.0 if x < 0 else 1.0 if x > 1 else x
    return 4 * t * t * t if t < 0.5 else 1 - ((-2 * t + 2) ** 3) / 2


def plate_duration(job: Job, p: Params) -> int:
    line = p.line_ms if job.line_order.size else 0
    tone = p.tone_ms if job.tone_order.size else 0
    return line + tone + p.hold_ms


def _line_count(job: Job, p: Params, t: float) -> int:
    line_ms = p.line_ms if job.line_order.size else 0
    if t < line_ms:
        local = t / line_ms if line_ms else 1
        k = local if job.tone_order.size == 0 else _ease(local)
        return int(k * job.line_order.size)
    return int(job.line_order.size)


def _tone_count(job: Job, p: Params, t: float) -> int:
    line_ms = p.line_ms if job.line_order.size else 0
    if t < line_ms:
        return 0
    after = t - line_ms
    tone_ms = p.tone_ms if job.tone_order.size else 0
    if tone_ms <= 0 or after >= tone_ms:
        return int(job.tone_order.size)
    return int(_ease(after / tone_ms) * job.tone_order.size)


def paint_job(job: Job, p: Params, t_ms: float) -> np.ndarray:
    h, w = job.height, job.width
    dest = np.zeros((h * w, 4), dtype=np.uint8)
    dest[:, 0] = PAPER[0]
    dest[:, 1] = PAPER[1]
    dest[:, 2] = PAPER[2]
    dest[:, 3] = 255
    lc = _line_count(job, p, t_ms)
    if lc > 0:
        idxs = job.line_order[:lc]
        if job.tone_order.size:
            keep = job.gray[idxs] <= LINE_MARK_MAX
            idxs = idxs[keep]
        dest[idxs] = job.rgba[idxs]
        dest[idxs, 3] = 255
    tc = _tone_count(job, p, t_ms)
    if tc > 0:
        idxs = job.tone_order[:tc]
        dest[idxs] = job.rgba[idxs]
        dest[idxs, 3] = 255
    key = max(0.0, min(1.0, p.transparency / 100.0))
    if key > 0:
        luma = (
            0.2126 * dest[:, 0] + 0.7152 * dest[:, 1] + 0.0722 * dest[:, 2]
        )
        lo = 255 - 125 * key
        hi = 255 - 8 * key
        span = max(1.0, hi - lo)
        fade = np.zeros(dest.shape[0], dtype=np.float32)
        fade[luma >= hi] = 1
        mid = (luma > lo) & (luma < hi)
        fade[mid] = (luma[mid] - lo) / span
        dest[:, 3] = np.clip(dest[:, 3] * (1 - fade * key), 0, 255).astype(np.uint8)
    return dest.reshape(h, w, 4)


def _blit_contain(stage: np.ndarray, plate_rgba: np.ndarray, frame: dict) -> None:
    sh, sw = stage.shape[:2]
    fx = frame["x"] * sw
    fy = frame["y"] * sh
    fw = frame["w"] * sw
    fh = frame["h"] * sh
    ph, pw = plate_rgba.shape[:2]
    if pw < 1 or ph < 1 or fw < 1 or fh < 1:
        return
    scale = min(fw / pw, fh / ph)
    dw = max(1, int(pw * scale))
    dh = max(1, int(ph * scale))
    dx = int(fx + (fw - dw) / 2)
    dy = int(fy + (fh - dh) / 2)
    img = Image.fromarray(plate_rgba, mode="RGBA").resize((dw, dh), Image.Resampling.LANCZOS)
    base = Image.fromarray(stage, mode="RGB").convert("RGBA")
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    layer.paste(img, (dx, dy), img)
    out = Image.alpha_composite(base, layer).convert("RGB")
    stage[:] = np.asarray(out, dtype=np.uint8)


def render_frame(stage_wh: tuple[int, int], plates: list[Plate], t_ms: float) -> np.ndarray:
    w, h = stage_wh
    stage = np.zeros((h, w, 3), dtype=np.uint8)
    stage[..., 0] = PAPER[0]
    stage[..., 1] = PAPER[1]
    stage[..., 2] = PAPER[2]
    for plate in plates:
        local = t_ms - plate.start_ms
        if local < 0:
            continue
        painted = paint_job(plate.job, plate.params, local)
        _blit_contain(stage, painted, plate.frame)
    return stage


def composition_ms(plates: list[Plate]) -> int:
    mx = 1
    for p in plates:
        mx = max(mx, p.start_ms + plate_duration(p.job, p.params))
    return mx


def raster_text(spec: dict, params: Params) -> np.ndarray:
    content = spec.get("content") or " "
    font_px = max(28, min(params.max_size, round(params.max_size * 0.42)))
    try:
        font = ImageFont.truetype(spec.get("fontFamily") or "DejaVuSerif.ttf", font_px)
    except OSError:
        try:
            font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf", font_px)
        except OSError:
            font = ImageFont.load_default()
    dummy = Image.new("RGB", (8, 8), PAPER)
    draw = ImageDraw.Draw(dummy)
    bbox = draw.multiline_textbbox((0, 0), content, font=font, spacing=int(font_px * 0.35))
    tw = max(8, bbox[2] - bbox[0] + font_px)
    th = max(8, bbox[3] - bbox[1] + font_px)
    scale = min(1.0, params.max_size / max(tw, th))
    if scale < 1:
        font_px = max(16, int(font_px * scale * 0.98))
        try:
            font = ImageFont.truetype(spec.get("fontFamily") or "DejaVuSerif.ttf", font_px)
        except OSError:
            font = ImageFont.load_default()
        bbox = draw.multiline_textbbox((0, 0), content, font=font, spacing=int(font_px * 0.35))
        tw = max(8, bbox[2] - bbox[0] + font_px)
        th = max(8, bbox[3] - bbox[1] + font_px)
    img = Image.new("RGB", (tw, th), PAPER)
    ImageDraw.Draw(img).multiline_text(
        (font_px * 0.35, font_px * 0.2),
        content,
        font=font,
        fill=(22, 18, 16),
        spacing=int(font_px * 0.35),
    )
    return np.asarray(img, dtype=np.uint8)
