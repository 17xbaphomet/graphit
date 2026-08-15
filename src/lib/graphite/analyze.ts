import type { AnalyzeParams, GraphiteJob, ToneLayer } from "./types";
import { DEFAULT_PARAMS } from "./types";

const DX = [-1, 0, 1, -1, 1, -1, 0, 1] as const;
const DY = [-1, -1, -1, 0, 0, 1, 1, 1] as const;

export async function loadRaster(
  source: File | string,
  maxSize: number,
): Promise<{ width: number; height: number; data: Uint8ClampedArray }> {
  let bitmap: ImageBitmap;
  if (typeof source === "string") {
    const img = await decodeImage(source);
    bitmap = await createImageBitmap(img);
  } else {
    bitmap = await createImageBitmap(source, { imageOrientation: "from-image" });
  }

  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas nicht verfügbar");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const { data } = ctx.getImageData(0, 0, width, height);
  return { width, height, data };
}

function decodeImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Bild konnte nicht geladen werden"));
    img.src = src;
  });
}

function toGray(rgba: Uint8ClampedArray, count: number): Uint8Array {
  const gray = new Uint8Array(count);
  for (let i = 0, p = 0; i < count; i++, p += 4) {
    gray[i] = Math.round(
      0.2126 * rgba[p] + 0.7152 * rgba[p + 1] + 0.0722 * rgba[p + 2],
    );
  }
  return gray;
}

function boxBlur3(src: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        const row = yy * w;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          sum += src[row + xx]!;
          n++;
        }
      }
      out[y * w + x] = (sum / n) | 0;
    }
  }
  return out;
}

function sobelMag(gray: Uint8Array, w: number, h: number): Float32Array {
  const mag = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    const row = y * w;
    const up = row - w;
    const down = row + w;
    for (let x = 1; x < w - 1; x++) {
      const a = gray[up + x - 1]!;
      const b = gray[up + x]!;
      const c = gray[up + x + 1]!;
      const d = gray[row + x - 1]!;
      const f = gray[row + x + 1]!;
      const g = gray[down + x - 1]!;
      const hv = gray[down + x]!;
      const j = gray[down + x + 1]!;
      const gx = -a + c - 2 * d + 2 * f - g + j;
      const gy = -a - 2 * b - c + g + 2 * hv + j;
      mag[row + x] = Math.hypot(gx, gy);
    }
  }
  return mag;
}

function peakMagnitude(mag: Float32Array): number {
  let max = 1;
  for (let i = 0; i < mag.length; i++) {
    const v = mag[i]!;
    if (v > max) max = v;
  }
  return max;
}

function isDarkContour(
  gray: Uint8Array,
  i: number,
  w: number,
  h: number,
  inkCut: number,
): boolean {
  if (gray[i]! > inkCut) return false;
  const x = i % w;
  const y = (i / w) | 0;
  for (let d = 0; d < 8; d++) {
    const xx = x + DX[d]!;
    const yy = y + DY[d]!;
    if (xx < 0 || xx >= w || yy < 0 || yy >= h) continue;
    if (gray[yy * w + xx]! > inkCut + 28) return true;
  }
  return false;
}

function pruneIsolatedAt(mask: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(mask);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      let n = 0;
      for (let d = 0; d < 8; d++) {
        const xx = x + DX[d]!;
        const yy = y + DY[d]!;
        if (xx < 0 || xx >= w || yy < 0 || yy >= h) continue;
        if (mask[yy * w + xx]) n++;
      }
      if (n === 0) out[i] = 0;
    }
  }
  return out;
}

function neighborCount(
  mask: Uint8Array,
  i: number,
  w: number,
  h: number,
): number {
  const x = i % w;
  const y = (i / w) | 0;
  let n = 0;
  for (let d = 0; d < 8; d++) {
    const xx = x + DX[d]!;
    const yy = y + DY[d]!;
    if (xx < 0 || xx >= w || yy < 0 || yy >= h) continue;
    if (mask[yy * w + xx]) n++;
  }
  return n;
}

function pickNext(
  mask: Uint8Array,
  visited: Uint8Array,
  cur: number,
  prevDx: number,
  prevDy: number,
  w: number,
  h: number,
): number {
  const x = cur % w;
  const y = (cur / w) | 0;
  let best = -1;
  let bestScore = -1e9;
  for (let d = 0; d < 8; d++) {
    const xx = x + DX[d]!;
    const yy = y + DY[d]!;
    if (xx < 0 || xx >= w || yy < 0 || yy >= h) continue;
    const j = yy * w + xx;
    if (!mask[j] || visited[j]) continue;
    const ndx = DX[d]!;
    const ndy = DY[d]!;
    const align = prevDx * ndx + prevDy * ndy;
    const cardinal = d === 1 || d === 3 || d === 4 || d === 6 ? 0.2 : 0;
    const score = align * 2 + cardinal;
    if (score > bestScore) {
      bestScore = score;
      best = j;
    }
  }
  return best;
}

function traceStrokes(mask: Uint8Array, w: number, h: number): number[][] {
  const n = w * h;
  const visited = new Uint8Array(n);
  const pixels: number[] = [];
  const endpoints: number[] = [];

  for (let i = 0; i < n; i++) {
    if (!mask[i]) continue;
    pixels.push(i);
    if (neighborCount(mask, i, w, h) <= 1) endpoints.push(i);
  }

  const strokes: number[][] = [];

  const walk = (start: number) => {
    const stroke: number[] = [];
    let cur = start;
    let prevDx = 0;
    let prevDy = 0;
    while (cur >= 0 && !visited[cur]) {
      visited[cur] = 1;
      stroke.push(cur);
      const cx = cur % w;
      const cy = (cur / w) | 0;
      const next = pickNext(mask, visited, cur, prevDx, prevDy, w, h);
      if (next >= 0) {
        prevDx = (next % w) - cx;
        prevDy = ((next / w) | 0) - cy;
      }
      cur = next;
    }
    if (stroke.length > 0) strokes.push(stroke);
  };

  for (const ep of endpoints) {
    if (!visited[ep]) walk(ep);
  }
  for (const i of pixels) {
    if (!visited[i]) walk(i);
  }

  return strokes;
}

type TourOpts = {
  minLen?: number;
  startX?: number;
  startY?: number;
};

function flattenStrokes(
  strokes: number[][],
  w: number,
  opts: TourOpts = {},
): Uint32Array {
  const minLen = opts.minLen ?? 3;
  const items = strokes.filter((s) => s.length >= minLen);
  if (items.length === 0) return new Uint32Array(0);

  let total = 0;
  for (const s of items) total += s.length;
  const order = new Uint32Array(total);
  const used = new Uint8Array(items.length);

  const startsX = new Int32Array(items.length);
  const startsY = new Int32Array(items.length);
  const endsX = new Int32Array(items.length);
  const endsY = new Int32Array(items.length);
  for (let i = 0; i < items.length; i++) {
    const s = items[i]!;
    const a = s[0]!;
    const b = s[s.length - 1]!;
    startsX[i] = a % w;
    startsY[i] = (a / w) | 0;
    endsX[i] = b % w;
    endsY[i] = (b / w) | 0;
  }

  const pickBrute = (px: number, py: number) => {
    let best = -1;
    let bestD = 1e15;
    let reverse = false;
    for (let i = 0; i < items.length; i++) {
      if (used[i]) continue;
      const da =
        (startsX[i]! - px) * (startsX[i]! - px) +
        (startsY[i]! - py) * (startsY[i]! - py);
      const db =
        (endsX[i]! - px) * (endsX[i]! - px) +
        (endsY[i]! - py) * (endsY[i]! - py);
      const bias = 1 / (1 + items[i]!.length * 0.0015);
      if (da * bias < bestD) {
        bestD = da * bias;
        best = i;
        reverse = false;
      }
      if (db * bias < bestD) {
        bestD = db * bias;
        best = i;
        reverse = true;
      }
    }
    return { best, reverse };
  };

  const CELL = 48;
  const useGrid = items.length > 360;
  const buckets = new Map<number, number[]>();
  const cellKey = (x: number, y: number) =>
    ((y / CELL) | 0) * 1_048_576 + ((x / CELL) | 0);
  if (useGrid) {
    for (let i = 0; i < items.length; i++) {
      const k1 = cellKey(startsX[i]!, startsY[i]!);
      const b1 = buckets.get(k1);
      if (b1) b1.push(i);
      else buckets.set(k1, [i]);
      const k2 = cellKey(endsX[i]!, endsY[i]!);
      if (k2 !== k1) {
        const b2 = buckets.get(k2);
        if (b2) b2.push(i);
        else buckets.set(k2, [i]);
      }
    }
  }

  const pickNear = (px: number, py: number) => {
    if (!useGrid) return pickBrute(px, py);
    const cx = (px / CELL) | 0;
    const cy = (py / CELL) | 0;
    for (let r = 0; r <= 96; r++) {
      let best = -1;
      let bestD = 1e15;
      let reverse = false;
      let any = false;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (r > 0 && Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const bucket = buckets.get((cy + dy) * 1_048_576 + (cx + dx));
          if (!bucket) continue;
          for (const i of bucket) {
            if (used[i]) continue;
            any = true;
            const da =
              (startsX[i]! - px) * (startsX[i]! - px) +
              (startsY[i]! - py) * (startsY[i]! - py);
            const db =
              (endsX[i]! - px) * (endsX[i]! - px) +
              (endsY[i]! - py) * (endsY[i]! - py);
            const bias = 1 / (1 + items[i]!.length * 0.0015);
            if (da * bias < bestD) {
              bestD = da * bias;
              best = i;
              reverse = false;
            }
            if (db * bias < bestD) {
              bestD = db * bias;
              best = i;
              reverse = true;
            }
          }
        }
      }
      if (any && best >= 0) return { best, reverse };
    }
    return pickBrute(px, py);
  };

  const hasStart = opts.startX !== undefined && opts.startY !== undefined;
  let idx = 0;
  let reverseFirst = false;

  if (hasStart) {
    const picked = pickNear(opts.startX!, opts.startY!);
    idx = picked.best;
    reverseFirst = picked.reverse;
  } else {
    let bestLen = -1;
    for (let i = 0; i < items.length; i++) {
      const n = items[i]!.length;
      if (n > bestLen) {
        bestLen = n;
        idx = i;
      }
    }
  }

  let o = 0;
  for (let step = 0; step < items.length; step++) {
    if (step > 0) {
      const last = order[o - 1]!;
      const picked = pickNear(last % w, (last / w) | 0);
      idx = picked.best;
      reverseFirst = picked.reverse;
    }
    if (idx < 0) break;
    if (reverseFirst) items[idx]!.reverse();
    used[idx] = 1;
    const s = items[idx]!;
    for (const p of s) order[o++] = p;
  }

  return o === order.length ? order : order.subarray(0, o);
}

function orderMask(
  mask: Uint8Array,
  w: number,
  h: number,
  startX?: number,
  startY?: number,
): Uint32Array {
  return flattenStrokes(traceStrokes(mask, w, h), w, {
    minLen: 1,
    startX,
    startY,
  });
}

function buildLayers(
  gray: Uint8Array,
  w: number,
  h: number,
  levels: number,
  startX?: number,
  startY?: number,
): { layers: ToneLayer[]; pixelLevel: Uint8Array } {
  const bins: number[][] = Array.from({ length: levels }, () => []);
  for (let i = 0; i < gray.length; i++) {
    const bin = Math.min(levels - 1, (gray[i]! * levels) >> 8);
    bins[bin]!.push(i);
  }

  const layers: ToneLayer[] = [];
  const pixelLevel = new Uint8Array(gray.length);
  let sx = startX;
  let sy = startY;
  let li = 0;

  for (let b = 0; b < levels; b++) {
    const pix = bins[b]!;
    if (pix.length === 0) continue;
    const mask = new Uint8Array(gray.length);
    for (const p of pix) mask[p] = 1;
    const ordered = orderMask(mask, w, h, sx, sy);
    for (const p of ordered) pixelLevel[p] = li;
    layers.push({
      value: Math.round(((b + 0.5) * 255) / levels),
      pixels: ordered,
    });
    if (ordered.length > 0) {
      const last = ordered[ordered.length - 1]!;
      sx = last % w;
      sy = (last / w) | 0;
    }
    li++;
  }
  return { layers, pixelLevel };
}

function samplePaper(
  rgba: Uint8ClampedArray,
  gray: Uint8Array,
): [number, number, number, number] {
  let best = 0;
  let idx = 0;
  for (let i = 0; i < gray.length; i++) {
    if (gray[i]! > best) {
      best = gray[i]!;
      idx = i;
    }
  }
  const p = idx * 4;
  return [rgba[p]!, rgba[p + 1]!, rgba[p + 2]!, 255];
}

export function analyzeRaster(
  width: number,
  height: number,
  rgba: Uint8ClampedArray,
  params: AnalyzeParams = DEFAULT_PARAMS,
): GraphiteJob {
  const count = width * height;
  const gray = toGray(rgba, count);
  const blurred = boxBlur3(gray, width, height);
  const mag = sobelMag(blurred, width, height);
  const rawMask = new Uint8Array(count);
  const cut = (params.edgeThreshold / 100) * peakMagnitude(mag);
  const inkCut = params.includeInk ? params.inkThreshold : -1;
  for (let i = 0; i < count; i++) {
    const edge = mag[i]! >= cut;
    const ink = inkCut >= 0 && isDarkContour(gray, i, width, height, inkCut);
    if (edge || ink) rawMask[i] = 1;
  }
  const mask = pruneIsolatedAt(rawMask, width, height);

  const strokes = traceStrokes(mask, width, height);
  const lineOrder = flattenStrokes(strokes, width, {
    minLen: Math.max(1, params.minStroke),
  });
  let sx: number | undefined;
  let sy: number | undefined;
  if (lineOrder.length > 0) {
    const last = lineOrder[lineOrder.length - 1]!;
    sx = last % width;
    sy = (last / width) | 0;
  }
  const { layers, pixelLevel } = buildLayers(
    gray,
    width,
    height,
    params.levels,
    sx,
    sy,
  );
  let toneCount = 0;
  for (const layer of layers) toneCount += layer.pixels.length;
  const toneOrder = new Uint32Array(toneCount);
  let to = 0;
  for (const layer of layers) {
    toneOrder.set(layer.pixels, to);
    to += layer.pixels.length;
  }
  const paper = samplePaper(rgba, gray);

  return {
    width,
    height,
    rgba: new Uint8ClampedArray(rgba),
    gray,
    lineOrder,
    toneOrder,
    layers,
    pixelLevel,
    paper,
    ink: [28, 24, 20, 255],
  };
}

export async function analyzeSource(
  source: File | string,
  params: AnalyzeParams = DEFAULT_PARAMS,
): Promise<GraphiteJob> {
  const { width, height, data } = await loadRaster(source, params.maxSize);
  return analyzeRaster(width, height, data, params);
}
