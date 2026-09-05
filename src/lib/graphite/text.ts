import { thinMask } from "./analyze";
import type { AnalyzeParams, GraphiteJob, TextSpec } from "./types";
import { STAGE_PAPER } from "./types";

export const SYSTEM_FONTS = [
  { label: "Instrument", family: '"Instrument Serif", Georgia, serif' },
  { label: "Georgia", family: "Georgia, serif" },
  { label: "Garamond", family: "Garamond, 'Palatino Linotype', serif" },
  { label: "Times", family: '"Times New Roman", Times, serif' },
  { label: "Figtree", family: "Figtree, system-ui, sans-serif" },
  { label: "Sans", family: "system-ui, sans-serif" },
  { label: "Mono", family: "ui-monospace, monospace" },
] as const;

export const DEFAULT_TEXT: TextSpec = {
  content: "Graphit",
  fontFamily: SYSTEM_FONTS[0].family,
  fontWeight: 400,
  italic: false,
  speed: 1,
};

export function textWriteMs(pixelCount: number, speed = 1): number {
  const s = Math.min(2.5, Math.max(0.25, speed || 1));
  return Math.round(
    Math.min(28000, Math.max(700, (pixelCount / 7000) * (4800 / s))),
  );
}

type Role = "stem" | "bowl" | "arc" | "bar" | "dot";

const RECIPE: Record<string, Role[]> = {
  a: ["stem", "bowl"],
  ä: ["stem", "bowl", "dot", "dot"],
  b: ["stem", "bowl"],
  c: ["arc"],
  d: ["stem", "bowl"],
  e: ["arc", "bar"],
  f: ["stem", "bar"],
  g: ["stem", "bowl"],
  h: ["stem", "arc"],
  i: ["stem", "dot"],
  j: ["stem", "dot"],
  k: ["stem", "arc", "arc"],
  l: ["stem"],
  m: ["stem", "arc", "arc"],
  n: ["stem", "arc"],
  o: ["bowl"],
  ö: ["bowl", "dot", "dot"],
  p: ["stem", "bowl"],
  q: ["stem", "bowl"],
  r: ["stem", "arc"],
  s: ["arc"],
  t: ["stem", "bar"],
  u: ["arc"],
  ü: ["arc", "dot", "dot"],
  v: ["arc"],
  w: ["arc"],
  x: ["arc", "arc"],
  y: ["arc"],
  z: ["arc"],
  ß: ["stem", "bowl", "arc"],
  A: ["stem", "stem", "bar"],
  B: ["stem", "bowl", "bowl"],
  C: ["arc"],
  D: ["stem", "bowl"],
  E: ["stem", "bar", "bar", "bar"],
  F: ["stem", "bar", "bar"],
  G: ["arc", "bar"],
  H: ["stem", "stem", "bar"],
  I: ["stem"],
  J: ["stem"],
  K: ["stem", "arc", "arc"],
  L: ["stem", "bar"],
  M: ["stem", "stem", "arc"],
  N: ["stem", "arc", "stem"],
  O: ["bowl"],
  P: ["stem", "bowl"],
  Q: ["bowl", "bar"],
  R: ["stem", "bowl", "arc"],
  S: ["arc"],
  T: ["stem", "bar"],
  U: ["arc"],
  V: ["arc"],
  W: ["arc"],
  X: ["arc", "arc"],
  Y: ["arc", "stem"],
  Z: ["arc"],
  "0": ["bowl"],
  "1": ["stem"],
  "2": ["arc", "bar"],
  "3": ["arc"],
  "4": ["stem", "bar"],
  "5": ["bar", "arc"],
  "6": ["bowl"],
  "7": ["bar", "stem"],
  "8": ["bowl", "bowl"],
  "9": ["bowl"],
  "?": ["arc", "dot"],
  "!": ["stem", "dot"],
  "-": ["bar"],
  "=": ["bar", "bar"],
  "+": ["bar", "stem"],
};

export function textSignature(spec: TextSpec | undefined): string {
  if (!spec) return "";
  return `${spec.content}\n${spec.fontFamily}\n${spec.fontWeight}\n${spec.italic ? 1 : 0}`;
}

const fontFaces = new Map<File, string>();

export async function registerFontFile(file: File): Promise<string> {
  const cached = fontFaces.get(file);
  if (cached) return cached;
  const name = `gf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const face = new FontFace(name, await file.arrayBuffer());
  await face.load();
  document.fonts.add(face);
  fontFaces.set(file, name);
  return name;
}

function cssFont(spec: TextSpec, px: number): string {
  const style = spec.italic ? "italic" : "normal";
  const family = spec.fontFamily.includes(" ") && !spec.fontFamily.includes(",")
    ? `"${spec.fontFamily}"`
    : spec.fontFamily;
  return `${style} ${spec.fontWeight} ${px}px ${family}`;
}

async function loadFont(spec: TextSpec, px: number) {
  try {
    await document.fonts.load(cssFont(spec, px));
  } catch {
    /* system fallback */
  }
}

function chamferDistance(mask: Uint8Array, w: number, h: number): Float32Array {
  const inf = 1e8;
  const dist = new Float32Array(w * h);
  for (let i = 0; i < dist.length; i++) dist[i] = mask[i] ? inf : 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      let d = dist[i]!;
      if (x > 0) d = Math.min(d, dist[i - 1]! + 3);
      if (y > 0) d = Math.min(d, dist[i - w]! + 3);
      if (x > 0 && y > 0) d = Math.min(d, dist[i - w - 1]! + 4);
      if (x + 1 < w && y > 0) d = Math.min(d, dist[i - w + 1]! + 4);
      dist[i] = d;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (!mask[i]) continue;
      let d = dist[i]!;
      if (x + 1 < w) d = Math.min(d, dist[i + 1]! + 3);
      if (y + 1 < h) d = Math.min(d, dist[i + w]! + 3);
      if (x + 1 < w && y + 1 < h) d = Math.min(d, dist[i + w + 1]! + 4);
      if (x > 0 && y + 1 < h) d = Math.min(d, dist[i + w - 1]! + 4);
      dist[i] = d;
    }
  }
  for (let i = 0; i < dist.length; i++) dist[i] = dist[i]! / 3;
  return dist;
}

const DX = [-1, 0, 1, -1, 1, -1, 0, 1] as const;
const DY = [-1, -1, -1, 0, 0, 1, 1, 1] as const;

function degreeAt(mask: Uint8Array, i: number, w: number, h: number): number {
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

function pickAhead(
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
    const cardinal = d === 1 || d === 3 || d === 4 || d === 6 ? 0.15 : 0;
    const score = align * 3 + cardinal;
    if (score > bestScore) {
      bestScore = score;
      best = j;
    }
  }
  return best;
}

function floodComponent(
  mask: Uint8Array,
  start: number,
  w: number,
  h: number,
  seen: Uint8Array,
): number[] {
  const pix: number[] = [];
  const stack = [start];
  seen[start] = 1;
  while (stack.length) {
    const i = stack.pop()!;
    pix.push(i);
    const x = i % w;
    const y = (i / w) | 0;
    for (let d = 0; d < 8; d++) {
      const xx = x + DX[d]!;
      const yy = y + DY[d]!;
      if (xx < 0 || xx >= w || yy < 0 || yy >= h) continue;
      const j = yy * w + xx;
      if (!mask[j] || seen[j]) continue;
      seen[j] = 1;
      stack.push(j);
    }
  }
  return pix;
}

function pruneSpurs(
  mask: Uint8Array,
  w: number,
  h: number,
  minLen: number,
): Uint8Array {
  const img = new Uint8Array(mask);
  const seen = new Uint8Array(img.length);
  const keepSmall = new Uint8Array(img.length);
  for (let i = 0; i < img.length; i++) {
    if (!img[i] || seen[i]) continue;
    const comp = floodComponent(img, i, w, h, seen);
    if (comp.length < minLen * 3) {
      for (const p of comp) keepSmall[p] = 1;
    }
  }
  let changed = true;
  for (let iter = 0; iter < 32 && changed; iter++) {
    changed = false;
    const used = new Uint8Array(img.length);
    for (let i = 0; i < img.length; i++) {
      if (!img[i] || keepSmall[i] || used[i]) continue;
      if (degreeAt(img, i, w, h) !== 1) continue;
      const chain: number[] = [];
      let cur = i;
      let prev = -1;
      while (cur >= 0 && img[cur] && !used[cur]) {
        const deg = degreeAt(img, cur, w, h);
        if (chain.length > 0 && deg !== 2) break;
        used[cur] = 1;
        chain.push(cur);
        const x = cur % w;
        const y = (cur / w) | 0;
        let next = -1;
        for (let d = 0; d < 8; d++) {
          const xx = x + DX[d]!;
          const yy = y + DY[d]!;
          if (xx < 0 || xx >= w || yy < 0 || yy >= h) continue;
          const j = yy * w + xx;
          if (!img[j] || j === prev) continue;
          next = j;
          if (degreeAt(img, j, w, h) !== 2) break;
        }
        prev = cur;
        cur = next;
      }
      if (chain.length > 0 && chain.length < minLen) {
        for (const p of chain) img[p] = 0;
        changed = true;
      }
    }
  }
  return img;
}

function bfsFar(
  start: number,
  allow: Uint8Array,
  w: number,
  h: number,
): { far: number; prev: Int32Array } {
  const prev = new Int32Array(allow.length);
  prev.fill(-1);
  const q = [start];
  prev[start] = start;
  let far = start;
  for (let qi = 0; qi < q.length; qi++) {
    const i = q[qi]!;
    far = i;
    const x = i % w;
    const y = (i / w) | 0;
    for (let d = 0; d < 8; d++) {
      const xx = x + DX[d]!;
      const yy = y + DY[d]!;
      if (xx < 0 || xx >= w || yy < 0 || yy >= h) continue;
      const j = yy * w + xx;
      if (!allow[j] || prev[j] >= 0) continue;
      prev[j] = i;
      q.push(j);
    }
  }
  return { far, prev };
}

function reconstruct(prev: Int32Array, root: number, end: number): number[] {
  const path: number[] = [];
  let cur = end;
  const guard = prev.length + 2;
  for (let n = 0; n < guard && cur >= 0; n++) {
    path.push(cur);
    if (cur === root) break;
    const p = prev[cur]!;
    if (p === cur) break;
    cur = p;
  }
  path.reverse();
  return path;
}

function walkCycle(
  allow: Uint8Array,
  pixels: number[],
  w: number,
  h: number,
): number[] {
  let start = pixels[0]!;
  let bestY = 1e9;
  let bestX = 1e9;
  for (const i of pixels) {
    if (!allow[i]) continue;
    const x = i % w;
    const y = (i / w) | 0;
    if (y < bestY || (y === bestY && x < bestX)) {
      start = i;
      bestY = y;
      bestX = x;
    }
  }
  const visited = new Uint8Array(allow.length);
  const path: number[] = [];
  let cur = start;
  let prevDx = 0;
  let prevDy = 0;
  while (cur >= 0 && allow[cur] && !visited[cur]) {
    visited[cur] = 1;
    path.push(cur);
    const x = cur % w;
    const y = (cur / w) | 0;
    const next = pickAhead(allow, visited, cur, prevDx, prevDy, w, h);
    if (next >= 0) {
      prevDx = (next % w) - x;
      prevDy = ((next / w) | 0) - y;
    }
    cur = next;
  }
  return path;
}

function pathFromHighest(
  allow: Uint8Array,
  pixels: number[],
  w: number,
  h: number,
): number[] {
  const ends: number[] = [];
  for (const i of pixels) {
    if (allow[i] && degreeAt(allow, i, w, h) <= 1) ends.push(i);
  }
  if (ends.length === 0) return walkCycle(allow, pixels, w, h);
  let start = ends[0]!;
  let sy = (start / w) | 0;
  let sx = start % w;
  for (const i of ends) {
    const x = i % w;
    const y = (i / w) | 0;
    if (y < sy || (y === sy && x < sx)) {
      start = i;
      sy = y;
      sx = x;
    }
  }
  const { far, prev } = bfsFar(start, allow, w, h);
  return reconstruct(prev, start, far);
}

function chunkBBox(chunk: number[], w: number) {
  let minX = 1e9;
  let minY = 1e9;
  let maxX = 0;
  let maxY = 0;
  for (const i of chunk) {
    const x = i % w;
    const y = (i / w) | 0;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY, bw: maxX - minX + 1, bh: maxY - minY + 1 };
}

function isDot(chunk: number[], w: number, glyphH: number): boolean {
  if (chunk.length <= 12) return true;
  const b = chunkBBox(chunk, w);
  return Math.max(b.bw, b.bh) < glyphH * 0.28 && chunk.length < glyphH * glyphH * 0.04;
}

function isCrossbar(chunk: number[], w: number): boolean {
  const b = chunkBBox(chunk, w);
  return b.bw >= b.bh * 1.2 && b.bh <= b.bw * 0.85;
}

function junctionsOnMain(
  chunk: number[],
  mainAt: Int32Array,
  w: number,
  h: number,
): number[] {
  const found = new Set<number>();
  for (const i of chunk) {
    const x = i % w;
    const y = (i / w) | 0;
    for (let d = 0; d < 8; d++) {
      const xx = x + DX[d]!;
      const yy = y + DY[d]!;
      if (xx < 0 || xx >= w || yy < 0 || yy >= h) continue;
      const j = yy * w + xx;
      const idx = mainAt[j]!;
      if (idx >= 0) found.add(idx);
    }
  }
  return [...found].sort((a, b) => b - a);
}

function walkBranch(
  allow: Uint8Array,
  start: number,
  w: number,
  h: number,
): number[] {
  const visited = new Uint8Array(allow.length);
  const path: number[] = [];
  let cur = start;
  let prevDx = 0;
  let prevDy = 0;
  while (cur >= 0 && allow[cur] && !visited[cur]) {
    visited[cur] = 1;
    path.push(cur);
    const x = cur % w;
    const y = (cur / w) | 0;
    const next = pickAhead(allow, visited, cur, prevDx, prevDy, w, h);
    if (next >= 0) {
      prevDx = (next % w) - x;
      prevDy = ((next / w) | 0) - y;
    }
    cur = next;
  }
  return path;
}

function branchStart(
  chunkAllow: Uint8Array,
  mainPix: number,
  w: number,
  h: number,
): number {
  const x = mainPix % w;
  const y = (mainPix / w) | 0;
  for (let d = 0; d < 8; d++) {
    const xx = x + DX[d]!;
    const yy = y + DY[d]!;
    if (xx < 0 || xx >= w || yy < 0 || yy >= h) continue;
    const j = yy * w + xx;
    if (chunkAllow[j]) return j;
  }
  return -1;
}

function higherJoin(
  js: number[],
  main: number[],
  w: number,
): number {
  let best = js[0]!;
  let bestY = (main[best]! / w) | 0;
  for (const idx of js) {
    const y = (main[idx]! / w) | 0;
    if (y < bestY || (y === bestY && idx < best)) {
      best = idx;
      bestY = y;
    }
  }
  return best;
}

function alongMain(main: number[], from: number, to: number): number[] {
  const out: number[] = [];
  if (from <= to) {
    for (let k = from; k <= to; k++) out.push(main[k]!);
  } else {
    for (let k = from; k >= to; k--) out.push(main[k]!);
  }
  return out;
}

function topToBottom(path: number[], w: number): number[] {
  if (path.length < 2) return path;
  const ya = (path[0]! / w) | 0;
  const yb = (path[path.length - 1]! / w) | 0;
  if (yb < ya) path.reverse();
  return path;
}

function startHigh(path: number[], w: number): number[] {
  if (path.length < 2) return path;
  const a = path[0]!;
  const b = path[path.length - 1]!;
  const ya = (a / w) | 0;
  const yb = (b / w) | 0;
  if (yb < ya || (yb === ya && (b % w) < (a % w))) path.reverse();
  return path;
}

function leavingDir(
  pix: number[],
  atStart: boolean,
  w: number,
): [number, number] {
  const n = pix.length;
  const span = Math.min(8, n - 1);
  if (span < 1) return [1, 0];
  const a = atStart ? pix[0]! : pix[n - 1]!;
  const b = atStart ? pix[span]! : pix[n - 1 - span]!;
  let dx = (b % w) - (a % w);
  let dy = ((b / w) | 0) - ((a / w) | 0);
  const len = Math.hypot(dx, dy) || 1;
  return [dx / len, dy / len];
}

function collectEdges(
  allow: Uint8Array,
  w: number,
  h: number,
): { a: number; b: number; pix: number[] }[] {
  const pixels: number[] = [];
  for (let i = 0; i < allow.length; i++) if (allow[i]) pixels.push(i);
  if (pixels.length === 0) return [];
  const isNode = (i: number) => degreeAt(allow, i, w, h) !== 2;
  const nodes = pixels.filter(isNode);
  if (nodes.length === 0) {
    const loop = walkCycle(allow, pixels, w, h);
    const s = loop[0] ?? 0;
    return [{ a: s, b: s, pix: loop }];
  }
  const seen = new Uint8Array(allow.length);
  const edges: { a: number; b: number; pix: number[] }[] = [];
  const edgeKey = new Set<string>();
  for (const start of nodes) {
    const x0 = start % w;
    const y0 = (start / w) | 0;
    for (let d = 0; d < 8; d++) {
      const xx = x0 + DX[d]!;
      const yy = y0 + DY[d]!;
      if (xx < 0 || xx >= w || yy < 0 || yy >= h) continue;
      const n = yy * w + xx;
      if (!allow[n]) continue;
      if (seen[n] && !isNode(n)) continue;
      const pix = [start];
      let cur = n;
      let prev = start;
      let guard = 0;
      while (cur >= 0 && allow[cur] && guard++ < allow.length) {
        pix.push(cur);
        if (isNode(cur) && cur !== start) break;
        if (!isNode(cur)) seen[cur] = 1;
        const x = cur % w;
        const y = (cur / w) | 0;
        let next = -1;
        for (let e = 0; e < 8; e++) {
          const nx = x + DX[e]!;
          const ny = y + DY[e]!;
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
          const j = ny * w + nx;
          if (!allow[j] || j === prev) continue;
          next = j;
          break;
        }
        prev = cur;
        cur = next;
        if (cur === start) {
          pix.push(start);
          break;
        }
      }
      if (pix.length < 2) continue;
      const end = pix[pix.length - 1]!;
      const k1 = `${start}-${end}-${pix.length}`;
      const k2 = `${end}-${start}-${pix.length}`;
      if (edgeKey.has(k1) || edgeKey.has(k2)) continue;
      edgeKey.add(k1);
      edges.push({ a: start, b: end, pix });
    }
  }
  const usedPix = new Uint8Array(allow.length);
  for (const e of edges) for (const p of e.pix) usedPix[p] = 1;
  const seen2 = new Uint8Array(allow.length);
  for (const i of pixels) {
    if (usedPix[i] || seen2[i]) continue;
    const rest = floodComponent(allow, i, w, h, seen2);
    if (rest.length) {
      const s = rest[0]!;
      edges.push({ a: s, b: rest[rest.length - 1]!, pix: rest });
    }
  }
  return edges;
}

function pairThroughJunctions(
  edges: { a: number; b: number; pix: number[] }[],
  w: number,
): number[][] {
  type Stroke = { pix: number[]; a: number; b: number; live: boolean };
  const strokes: Stroke[] = edges.map((e) => ({
    pix: e.pix.slice(),
    a: e.a,
    b: e.b,
    live: true,
  }));

  const endsAt = (node: number) => {
    const list: { s: number; atStart: boolean }[] = [];
    for (let i = 0; i < strokes.length; i++) {
      const st = strokes[i]!;
      if (!st.live) continue;
      if (st.a === node) list.push({ s: i, atStart: true });
      if (st.b === node && st.pix.length > 1) list.push({ s: i, atStart: false });
    }
    return list;
  };

  const nodes = new Set<number>();
  for (const e of edges) {
    nodes.add(e.a);
    nodes.add(e.b);
  }

  let merged = true;
  while (merged) {
    merged = false;
    for (const node of nodes) {
      const ends = endsAt(node);
      if (ends.length < 2) continue;
      let bestI = -1;
      let bestJ = -1;
      let bestDot = -0.28;
      for (let i = 0; i < ends.length; i++) {
        for (let j = i + 1; j < ends.length; j++) {
          const ei = ends[i]!;
          const ej = ends[j]!;
          if (ei.s === ej.s) continue;
          const di = leavingDir(strokes[ei.s]!.pix, ei.atStart, w);
          const dj = leavingDir(strokes[ej.s]!.pix, ej.atStart, w);
          const dot = di[0] * dj[0] + di[1] * dj[1];
          if (dot < bestDot) {
            bestDot = dot;
            bestI = i;
            bestJ = j;
          }
        }
      }
      if (bestI < 0) continue;
      const ei = ends[bestI]!;
      const ej = ends[bestJ]!;
      const A = strokes[ei.s]!;
      const B = strokes[ej.s]!;
      if (!ei.atStart) A.pix.reverse();
      if (ej.atStart) B.pix.reverse();
      A.pix = A.pix.concat(B.pix.slice(1));
      A.a = A.pix[0]!;
      A.b = A.pix[A.pix.length - 1]!;
      B.live = false;
      merged = true;
      break;
    }
  }

  const out: number[][] = [];
  for (const st of strokes) {
    if (!st.live || st.pix.length === 0) continue;
    out.push(startHigh(st.pix, w));
  }
  return out;
}

function writeLetter(
  img: Uint8Array,
  w: number,
  h: number,
  ch: string,
): number[] {
  const recipe =
    RECIPE[ch] ?? RECIPE[ch.toLowerCase()] ?? (["stem", "bowl", "arc", "bar", "dot"] as Role[]);
  const first = recipe[0] ?? "arc";
  const strokes = pairThroughJunctions(collectEdges(img, w, h), w);
  if (strokes.length === 0) return [];

  const dots: number[][] = [];
  const body: number[][] = [];
  for (const s of strokes) {
    if (isDot(s, w, h)) dots.push(s);
    else body.push(s);
  }

  const scoreStem = (s: number[]) => {
    const b = chunkBBox(s, w);
    return (b.bh * b.bh) / (b.bw + 1);
  };
  const scoreBar = (s: number[]) => {
    const b = chunkBBox(s, w);
    return (b.bw * b.bw) / (b.bh + 1);
  };
  const startY = (s: number[]) => (s[0]! / w) | 0;
  const startX = (s: number[]) => s[0]! % w;

  const unused = body.slice();
  const spine: number[] = [];
  let stem: number[] = [];
  let stemAt = new Int32Array(img.length);
  stemAt.fill(-1);
  let pos = -1;

  const pickIndex = (): number => {
    if (unused.length === 0) return -1;
    let best = 0;
    let bestS = -1e15;
    for (let i = 0; i < unused.length; i++) {
      const s = unused[i]!;
      let sc = 0;
      if (first === "stem") sc = scoreStem(s);
      else if (first === "bar") sc = scoreBar(s);
      else if (first === "bowl") sc = s.length + (s[0] === s[s.length - 1] ? 80 : 0);
      else sc = -startY(s) * 10 - startX(s) * 0.01 + s.length * 0.001;
      if (sc > bestS) {
        bestS = sc;
        best = i;
      }
    }
    return best;
  };

  const consume = (path: number[]) => {
    spine.push(...path);
    stem = path;
    stemAt = new Int32Array(img.length);
    stemAt.fill(-1);
    for (let k = 0; k < stem.length; k++) stemAt[stem[k]!] = k;
    pos = stem.length - 1;
  };

  const firstI = pickIndex();
  if (firstI >= 0) {
    const path =
      first === "stem"
        ? topToBottom(unused.splice(firstI, 1)[0]!, w)
        : unused.splice(firstI, 1)[0]!;
    consume(path);
  }

  for (const role of recipe.slice(1)) {
    if (unused.length === 0) break;
    if (role === "dot") continue;
    if (role === "bowl" || role === "arc") {
      let best = -1;
      let bestY = 1e9;
      let bestJoin = 0;
      for (let i = 0; i < unused.length; i++) {
        const js = junctionsOnMain(unused[i]!, stemAt, w, h);
        if (!js.length) continue;
        const join = higherJoin(js, stem, w);
        const y = (stem[join]! / w) | 0;
        if (y < bestY) {
          bestY = y;
          best = i;
          bestJoin = join;
        }
      }
      if (best < 0) continue;
      const path = unused.splice(best, 1)[0]!;
      if (pos >= 0 && stem.length) {
        spine.push(...alongMain(stem, pos, bestJoin));
        pos = bestJoin;
      }
      const from = stem.length ? stem[bestJoin]! : path[0]!;
      if ((path[0]! % w) === (from % w) && ((path[0]! / w) | 0) === ((from / w) | 0)) {
        spine.push(...path);
      } else if (
        (path[path.length - 1]! % w) === (from % w) &&
        ((path[path.length - 1]! / w) | 0) === ((from / w) | 0)
      ) {
        path.reverse();
        spine.push(...path);
      } else {
        spine.push(...path);
      }
      continue;
    }
    if (role === "bar") {
      let best = 0;
      let bestS = -1;
      for (let i = 0; i < unused.length; i++) {
        const s = scoreBar(unused[i]!);
        if (s > bestS) {
          bestS = s;
          best = i;
        }
      }
      unused.sort((a, b) => {
        const ba = chunkBBox(a, w);
        const bb = chunkBBox(b, w);
        if (ba.minY !== bb.minY) return ba.minY - bb.minY;
        return ba.minX - bb.minX;
      });
      const path = unused.splice(0, 1)[0]!;
      void best;
      spine.push(...path);
    }
    if (role === "stem") {
      let best = 0;
      let bestS = -1;
      for (let i = 0; i < unused.length; i++) {
        const s = scoreStem(unused[i]!);
        if (s > bestS) {
          bestS = s;
          best = i;
        }
      }
      const path = topToBottom(unused.splice(best, 1)[0]!, w);
      spine.push(...path);
      consume(path);
    }
  }

  unused.sort((a, b) => startY(a) - startY(b) || startX(a) - startX(b));
  for (const path of unused) spine.push(...path);
  dots.sort((a, b) => startX(a) - startX(b) || startY(a) - startY(b));
  for (const path of dots) spine.push(...path);
  return spine;
}

type Pt = [number, number];

function arcPts(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  t0: number,
  t1: number,
  n = 18,
): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = t0 + ((t1 - t0) * i) / n;
    out.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]);
  }
  return out;
}

function sPts(): Pt[] {
  const PI = Math.PI;
  return joinPts(
    arcPts(0.5, 0.28, 0.38, 0.26, -0.22 * PI, -1.5 * PI, 16),
    arcPts(0.5, 0.74, 0.38, 0.26, -0.5 * PI, -1.75 * PI, 16),
  );
}

function joinPts(...parts: Pt[][]): Pt[] {
  const out: Pt[] = [];
  for (const part of parts) {
    if (!part.length) continue;
    if (
      out.length &&
      Math.abs(out[out.length - 1]![0] - part[0]![0]) < 1e-6 &&
      Math.abs(out[out.length - 1]![1] - part[0]![1]) < 1e-6
    ) {
      out.push(...part.slice(1));
    } else out.push(...part);
  }
  return out;
}

function letterStrokes(ch: string): Pt[][] | null {
  const PI = Math.PI;
  const map: Record<string, Pt[][]> = {
    l: [[[0.5, 0.02], [0.5, 0.98]]],
    I: [[[0.5, 0.02], [0.5, 0.98]]],
    i: [
      [[0.5, 0.32], [0.5, 0.98]],
      [[0.5, 0.1]],
    ],
    j: [
      joinPts([[0.62, 0.32], [0.62, 0.78]], arcPts(0.4, 0.78, 0.22, 0.18, 0, PI)),
      [[0.62, 0.1]],
    ],
    o: [arcPts(0.5, 0.5, 0.4, 0.42, -PI / 2, 1.5 * PI, 28)],
    O: [arcPts(0.5, 0.5, 0.4, 0.44, -PI / 2, 1.5 * PI, 28)],
    "0": [arcPts(0.5, 0.5, 0.36, 0.44, -PI / 2, 1.5 * PI, 28)],
    c: [
      joinPts(
        [[0.82, 0.22]],
        arcPts(0.48, 0.5, 0.4, 0.42, -0.32 * PI, -0.32 * PI - 1.42 * PI, 24),
      ),
    ],
    C: [
      joinPts(
        [[0.84, 0.18]],
        arcPts(0.5, 0.5, 0.4, 0.44, -0.3 * PI, -0.3 * PI - 1.42 * PI, 24),
      ),
    ],
    e: [
      joinPts(
        [[0.18, 0.5], [0.82, 0.5]],
        arcPts(0.5, 0.5, 0.4, 0.4, 0, -1.7 * PI, 24),
      ),
    ],
    b: [
      joinPts(
        [[0.22, 0.02], [0.22, 0.98]],
        [[0.22, 0.98], [0.22, 0.4]],
        arcPts(0.54, 0.68, 0.32, 0.28, PI, 3 * PI, 24),
      ),
    ],
    d: [
      joinPts(
        [[0.82, 0.02], [0.82, 0.98]],
        [[0.82, 0.98], [0.82, 0.3]],
        arcPts(0.42, 0.62, 0.36, 0.3, -0.45 * PI, -0.45 * PI - 2 * PI, 26),
      ),
    ],
    p: [
      joinPts(
        [[0.22, 0.02], [0.22, 0.98]],
        [[0.22, 0.98], [0.22, 0.08]],
        arcPts(0.54, 0.3, 0.32, 0.26, PI, 3 * PI, 24),
      ),
    ],
    q: [
      joinPts(
        [[0.78, 0.02], [0.78, 0.98]],
        [[0.78, 0.98], [0.78, 0.08]],
        arcPts(0.46, 0.3, 0.32, 0.26, 0, 2 * PI, 24),
      ),
    ],
    h: [
      joinPts(
        [[0.2, 0.02], [0.2, 0.98]],
        [[0.2, 0.98], [0.2, 0.4]],
        arcPts(0.5, 0.42, 0.3, 0.22, PI, 2 * PI, 14),
        [[0.8, 0.42], [0.8, 0.98]],
      ),
    ],
    n: [
      joinPts(
        [[0.2, 0.28], [0.2, 0.98]],
        [[0.2, 0.98], [0.2, 0.4]],
        arcPts(0.5, 0.42, 0.3, 0.2, PI, 2 * PI, 14),
        [[0.8, 0.42], [0.8, 0.98]],
      ),
    ],
    m: [
      joinPts(
        [[0.1, 0.28], [0.1, 0.98]],
        [[0.1, 0.98], [0.1, 0.4]],
        arcPts(0.32, 0.42, 0.2, 0.18, PI, 2 * PI, 12),
        [[0.52, 0.42], [0.52, 0.98]],
        [[0.52, 0.98], [0.52, 0.4]],
        arcPts(0.74, 0.42, 0.2, 0.18, PI, 2 * PI, 12),
        [[0.94, 0.42], [0.94, 0.98]],
      ),
    ],
    r: [
      joinPts(
        [[0.22, 0.28], [0.22, 0.98]],
        [[0.22, 0.98], [0.22, 0.36]],
        arcPts(0.48, 0.38, 0.26, 0.16, PI, 1.85 * PI, 10),
      ),
    ],
    u: [
      joinPts(
        [[0.18, 0.22], [0.18, 0.72]],
        arcPts(0.5, 0.72, 0.32, 0.22, PI, 0, 14),
        [[0.82, 0.72], [0.82, 0.22]],
      ),
    ],
    t: [
      [[0.55, 0.05], [0.55, 0.98]],
      [[0.18, 0.28], [0.88, 0.28]],
    ],
    f: [
      joinPts(arcPts(0.62, 0.18, 0.28, 0.16, 1.15 * PI, 2 * PI, 10), [
        [0.9, 0.18],
        [0.38, 0.18],
        [0.38, 0.98],
      ]),
      [[0.14, 0.42], [0.72, 0.42]],
    ],
    g: [
      joinPts(
        arcPts(0.48, 0.42, 0.32, 0.26, -PI / 2, 1.5 * PI, 22),
        [[0.8, 0.42], [0.8, 0.78]],
        arcPts(0.5, 0.78, 0.3, 0.18, 0, PI, 12),
      ),
    ],
    s: [sPts()],
    S: [sPts()],
    v: [[[0.08, 0.28], [0.5, 0.98], [0.92, 0.28]]],
    V: [[[0.06, 0.04], [0.5, 0.96], [0.94, 0.04]]],
    w: [[[0.04, 0.28], [0.26, 0.98], [0.5, 0.4], [0.74, 0.98], [0.96, 0.28]]],
    W: [[[0.04, 0.04], [0.26, 0.96], [0.5, 0.28], [0.74, 0.96], [0.96, 0.04]]],
    x: [
      [[0.12, 0.28], [0.88, 0.98]],
      [[0.88, 0.28], [0.12, 0.98]],
    ],
    X: [
      [[0.1, 0.04], [0.9, 0.96]],
      [[0.9, 0.04], [0.1, 0.96]],
    ],
    y: [
      [[0.12, 0.28], [0.5, 0.7]],
      [[0.88, 0.28], [0.5, 0.7], [0.38, 0.98]],
    ],
    z: [
      [
        [0.1, 0.3],
        [0.9, 0.3],
        [0.1, 0.96],
        [0.9, 0.96],
      ],
    ],
    Z: [
      [
        [0.08, 0.06],
        [0.92, 0.06],
        [0.08, 0.94],
        [0.92, 0.94],
      ],
    ],
    k: [
      joinPts(
        [[0.2, 0.02], [0.2, 0.98]],
        [[0.2, 0.98], [0.2, 0.55]],
        [[0.2, 0.55], [0.86, 0.08]],
        [[0.86, 0.08], [0.2, 0.55], [0.88, 0.98]],
      ),
    ],
    K: [
      joinPts(
        [[0.18, 0.04], [0.18, 0.96]],
        [[0.18, 0.96], [0.18, 0.5]],
        [[0.18, 0.5], [0.88, 0.04]],
        [[0.88, 0.04], [0.18, 0.5], [0.9, 0.96]],
      ),
    ],
    A: [
      [[0.08, 0.96], [0.5, 0.04], [0.92, 0.96]],
      [[0.26, 0.6], [0.74, 0.6]],
    ],
    B: [
      joinPts(
        [[0.18, 0.04], [0.18, 0.96]],
        [[0.18, 0.96], [0.18, 0.06]],
        arcPts(0.5, 0.26, 0.34, 0.22, -PI / 2, PI / 2, 14),
        [[0.18, 0.48]],
        arcPts(0.52, 0.72, 0.36, 0.24, -PI / 2, PI / 2, 14),
        [[0.18, 0.96]],
      ),
    ],
    D: [
      joinPts(
        [[0.18, 0.04], [0.18, 0.96]],
        [[0.18, 0.96], [0.18, 0.04]],
        arcPts(0.42, 0.5, 0.42, 0.46, -PI / 2, PI / 2, 20),
        [[0.18, 0.96]],
      ),
    ],
    E: [
      [[0.2, 0.04], [0.2, 0.96]],
      [[0.2, 0.06], [0.88, 0.06]],
      [[0.2, 0.5], [0.72, 0.5]],
      [[0.2, 0.94], [0.88, 0.94]],
    ],
    F: [
      [[0.2, 0.04], [0.2, 0.96]],
      [[0.2, 0.06], [0.88, 0.06]],
      [[0.2, 0.5], [0.7, 0.5]],
    ],
    G: [
      joinPts(
        [[0.84, 0.18]],
        arcPts(0.5, 0.5, 0.4, 0.44, -0.3 * PI, -2 * PI, 26),
        [[0.9, 0.5], [0.52, 0.5]],
      ),
    ],
    H: [
      [[0.18, 0.04], [0.18, 0.96]],
      [[0.82, 0.04], [0.82, 0.96]],
      [[0.18, 0.5], [0.82, 0.5]],
    ],
    J: [
      joinPts([[0.7, 0.04], [0.7, 0.72]], arcPts(0.46, 0.72, 0.24, 0.22, 0, PI, 12)),
    ],
    L: [
      [[0.2, 0.04], [0.2, 0.96]],
      [[0.2, 0.96], [0.88, 0.96]],
    ],
    M: [
      [[0.08, 0.96], [0.08, 0.04], [0.5, 0.7], [0.92, 0.04], [0.92, 0.96]],
    ],
    N: [
      [[0.16, 0.96], [0.16, 0.04], [0.84, 0.96], [0.84, 0.04]],
    ],
    P: [
      joinPts(
        [[0.2, 0.04], [0.2, 0.96]],
        [[0.2, 0.96], [0.2, 0.04]],
        arcPts(0.52, 0.28, 0.34, 0.24, -PI / 2, PI / 2, 14),
        [[0.2, 0.52]],
      ),
    ],
    Q: [
      arcPts(0.5, 0.46, 0.4, 0.42, -PI / 2, 1.5 * PI, 26),
      [[0.62, 0.7], [0.88, 0.96]],
    ],
    R: [
      joinPts(
        [[0.2, 0.04], [0.2, 0.96]],
        [[0.2, 0.96], [0.2, 0.04]],
        arcPts(0.52, 0.28, 0.34, 0.24, -PI / 2, PI / 2, 14),
        [[0.2, 0.52], [0.88, 0.96]],
      ),
    ],
    Y: [
      [[0.1, 0.04], [0.5, 0.5], [0.9, 0.04], [0.5, 0.5], [0.5, 0.96]],
    ],
    T: [
      [[0.5, 0.08], [0.5, 0.96]],
      [[0.08, 0.06], [0.92, 0.06]],
    ],
    U: [
      joinPts(
        [[0.16, 0.04], [0.16, 0.7]],
        arcPts(0.5, 0.7, 0.34, 0.26, PI, 0, 16),
        [[0.84, 0.7], [0.84, 0.04]],
      ),
    ],
    "1": [[[0.28, 0.22], [0.55, 0.04], [0.55, 0.96]]],
    "4": [
      [[0.72, 0.04], [0.72, 0.96]],
      [[0.72, 0.04], [0.18, 0.62], [0.88, 0.62]],
    ],
    "7": [[[0.12, 0.06], [0.88, 0.06], [0.4, 0.96]]],
    "-": [[[0.1, 0.5], [0.9, 0.5]]],
    "=": [
      [[0.1, 0.38], [0.9, 0.38]],
      [[0.1, 0.62], [0.9, 0.62]],
    ],
    "+": [
      [[0.5, 0.2], [0.5, 0.8]],
      [[0.15, 0.5], [0.85, 0.5]],
    ],
    "!": [[[0.5, 0.04], [0.5, 0.68]], [[0.5, 0.88]]],
    "?": [
      joinPts(arcPts(0.5, 0.28, 0.28, 0.22, PI, 2.2 * PI, 16), [[0.5, 0.5], [0.5, 0.62]]),
      [[0.5, 0.88]],
    ],
  };
  map.ä = [...(map.a ?? []), [[0.32, 0.1]], [[0.64, 0.1]]];
  map.ö = [...(map.o ?? []), [[0.32, 0.1]], [[0.68, 0.1]]];
  map.ü = [...(map.u ?? []), [[0.32, 0.1]], [[0.68, 0.1]]];
  map.Ä = [...(map.A ?? []), [[0.32, 0.0]], [[0.68, 0.0]]];
  map.Ö = [...(map.O ?? []), [[0.32, 0.0]], [[0.68, 0.0]]];
  map.Ü = [...(map.U ?? []), [[0.32, 0.0]], [[0.68, 0.0]]];
  map.ß = map.b ?? [];
  return map[ch] ?? null;
}

function maskBBox(mask: Uint8Array, w: number, h: number) {
  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < minX) return { minX: 0, minY: 0, maxX: w - 1, maxY: h - 1 };
  return { minX, minY, maxX, maxY };
}

function resamplePts(pts: Pt[], spacing: number): Pt[] {
  if (pts.length === 0) return [];
  if (pts.length === 1) return [pts[0]!];
  const out: Pt[] = [pts[0]!];
  for (let i = 1; i < pts.length; i++) {
    const a = out[out.length - 1]!;
    const b = pts[i]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const dist = Math.hypot(dx, dy);
    const n = Math.max(1, Math.round(dist / spacing));
    for (let k = 1; k <= n; k++) {
      out.push([a[0] + (dx * k) / n, a[1] + (dy * k) / n]);
    }
  }
  return out;
}

function snapInk(
  x: number,
  y: number,
  mask: Uint8Array,
  w: number,
  h: number,
): number {
  const cx = Math.round(x);
  const cy = Math.round(y);
  let best = -1;
  let bestD = 1e9;
  for (let r = 0; r <= 5; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const xx = cx + dx;
        const yy = cy + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const j = yy * w + xx;
        if (!mask[j]) continue;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = j;
        }
      }
    }
    if (best >= 0) return best;
  }
  if (cx >= 0 && cy >= 0 && cx < w && cy < h) return cy * w + cx;
  return -1;
}

function spineFromTemplate(
  mask: Uint8Array,
  w: number,
  h: number,
  strokes: Pt[][],
): Uint32Array {
  const box = maskBBox(mask, w, h);
  const bw = Math.max(1, box.maxX - box.minX);
  const bh = Math.max(1, box.maxY - box.minY);
  const order: number[] = [];
  for (const stroke of strokes) {
    const mapped: Pt[] = stroke.map(([x, y]) => [
      box.minX + x * bw,
      box.minY + y * bh,
    ]);
    const dense = resamplePts(mapped, 0.85);
    for (const [x, y] of dense) {
      const j = snapInk(x, y, mask, w, h);
      if (j < 0) continue;
      if (order.length && order[order.length - 1] === j) continue;
      order.push(j);
    }
  }
  return new Uint32Array(order);
}

function snapRidge(
  x: number,
  y: number,
  mask: Uint8Array,
  dist: Float32Array,
  w: number,
  h: number,
  maxR: number,
): number {
  const cx = Math.round(x);
  const cy = Math.round(y);
  let best = -1;
  let bestScore = -1e9;
  const rMax = Math.max(2, Math.round(maxR));
  for (let dy = -rMax; dy <= rMax; dy++) {
    const yy = cy + dy;
    if (yy < 0 || yy >= h) continue;
    for (let dx = -rMax; dx <= rMax; dx++) {
      const xx = cx + dx;
      if (xx < 0 || xx >= w) continue;
      const j = yy * w + xx;
      if (!mask[j]) continue;
      const d = dist[j]!;
      const near = dx * dx + dy * dy;
      const score = d * 8 - near * 0.02;
      if (score > bestScore) {
        bestScore = score;
        best = j;
      }
    }
  }
  return best;
}

function strokePath(
  mask: Uint8Array,
  dist: Float32Array,
  w: number,
  h: number,
  box: { minX: number; minY: number; maxX: number; maxY: number },
  stroke: Pt[],
): number[] {
  const bw = Math.max(1, box.maxX - box.minX);
  const bh = Math.max(1, box.maxY - box.minY);
  const maxR = Math.max(3, Math.round(Math.min(bw, bh) * 0.1));
  const mapped: Pt[] = stroke.map(([u, v]) => [
    box.minX + u * bw,
    box.minY + v * bh,
  ]);
  const dense = resamplePts(mapped, 0.85);
  const out: number[] = [];
  for (const [x, y] of dense) {
    const j = snapRidge(x, y, mask, dist, w, h, maxR);
    if (j < 0) continue;
    if (out.length && out[out.length - 1] === j) continue;
    out.push(j);
  }
  return out;
}

function pathRadius(path: number[], dist: Float32Array): number {
  if (!path.length) return 2;
  const rs = path.map((i) => dist[i]!).sort((a, b) => a - b);
  const p = rs[Math.min(rs.length - 1, Math.floor(rs.length * 0.88))]!;
  return Math.max(2, p * 1.45 + 1.8);
}

function claimDisks(
  path: number[],
  mask: Uint8Array,
  claimed: Uint8Array,
  w: number,
  h: number,
  r: number,
): Uint8Array {
  const slice = new Uint8Array(mask.length);
  const rad = Math.ceil(r);
  const r2 = r * r;
  for (const p of path) {
    const x = p % w;
    const y = (p / w) | 0;
    for (let dy = -rad; dy <= rad; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= h) continue;
      for (let dx = -rad; dx <= rad; dx++) {
        if (dx * dx + dy * dy > r2) continue;
        const xx = x + dx;
        if (xx < 0 || xx >= w) continue;
        const j = yy * w + xx;
        if (!mask[j] || claimed[j]) continue;
        slice[j] = 1;
        claimed[j] = 1;
      }
    }
  }
  return slice;
}

function paintFromTemplate(
  mask: Uint8Array,
  dist: Float32Array,
  w: number,
  h: number,
  maxR: number,
  strokes: Pt[][],
): number[] {
  const box = maskBBox(mask, w, h);
  const paths: number[][] = [];
  const barish: boolean[] = [];
  for (const stroke of strokes) {
    const p = strokePath(mask, dist, w, h, box, stroke);
    if (p.length === 0) continue;
    paths.push(p);
    let minX = 1;
    let maxX = 0;
    let minY = 1;
    let maxY = 0;
    for (const [x, y] of stroke) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    barish.push(maxX - minX > (maxY - minY) * 1.35 && stroke.length > 1);
  }
  if (!paths.length) return [];
  if (paths.length === 1) {
    return brushAlong(new Uint32Array(paths[0]!), mask, dist, w, h, maxR);
  }

  const bodyIdx: number[] = [];
  const barIdx: number[] = [];
  for (let s = 0; s < paths.length; s++) {
    if (barish[s]) barIdx.push(s);
    else bodyIdx.push(s);
  }
  const sequence = [...bodyIdx, ...barIdx];
  const claimed = new Uint8Array(mask.length);
  const slices: Uint8Array[] = paths.map(() => new Uint8Array(mask.length));
  for (const s of sequence) {
    const r = pathRadius(paths[s]!, dist);
    const part = claimDisks(paths[s]!, mask, claimed, w, h, r);
    const slice = slices[s]!;
    for (let i = 0; i < mask.length; i++) if (part[i]) slice[i] = 1;
  }
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || claimed[i]) continue;
    const x = i % w;
    const y = (i / w) | 0;
    let best = sequence[0]!;
    let bestD = 1e15;
    for (const s of sequence) {
      const path = paths[s]!;
      for (let k = 0; k < path.length; k++) {
        const p = path[k]!;
        const dx = x - (p % w);
        const dy = y - ((p / w) | 0);
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = s;
        }
      }
    }
    slices[best]![i] = 1;
  }
  const out: number[] = [];
  for (const s of sequence) {
    out.push(
      ...brushAlong(new Uint32Array(paths[s]!), slices[s]!, dist, w, h, maxR),
    );
  }
  return out;
}
function largestHole(
  mask: Uint8Array,
  w: number,
  h: number,
): Uint8Array | null {
  const outside = new Uint8Array(mask.length);
  const q: number[] = [];
  const push = (i: number) => {
    if (mask[i] || outside[i]) return;
    outside[i] = 1;
    q.push(i);
  };
  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + w - 1);
  }
  for (let qi = 0; qi < q.length; qi++) {
    const i = q[qi]!;
    const x = i % w;
    const y = (i / w) | 0;
    if (x > 0) push(i - 1);
    if (x + 1 < w) push(i + 1);
    if (y > 0) push(i - w);
    if (y + 1 < h) push(i + w);
  }
  const holePaper = new Uint8Array(mask.length);
  for (let j = 0; j < holePaper.length; j++) {
    if (!mask[j] && !outside[j]) holePaper[j] = 1;
  }
  const seen = new Uint8Array(mask.length);
  let best: number[] | null = null;
  for (let i = 0; i < mask.length; i++) {
    if (!holePaper[i] || seen[i]) continue;
    const comp = floodComponent(holePaper, i, w, h, seen);
    if (!best || comp.length > best.length) best = comp;
  }
  if (!best || best.length < 8) return null;
  const hole = new Uint8Array(mask.length);
  for (const p of best) hole[p] = 1;
  return hole;
}

function nearHole(i: number, hole: Uint8Array, w: number, h: number): boolean {
  const x = i % w;
  const y = (i / w) | 0;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const xx = x + dx;
      const yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      if (hole[yy * w + xx]) return true;
    }
  }
  return false;
}

function spineFromCounter(
  mask: Uint8Array,
  w: number,
  h: number,
): Uint32Array | null {
  const hole = largestHole(mask, w, h);
  if (!hole) return null;
  const slim = thinMask(mask, w, h);
  const ring = new Uint8Array(slim.length);
  const stemM = new Uint8Array(slim.length);
  let ringN = 0;
  const ringPix: number[] = [];
  const stemPix: number[] = [];
  for (let i = 0; i < slim.length; i++) {
    if (!slim[i]) continue;
    if (nearHole(i, hole, w, h)) {
      ring[i] = 1;
      ringN++;
      ringPix.push(i);
    } else {
      stemM[i] = 1;
      stemPix.push(i);
    }
  }
  if (ringN < 8) return null;
  let loop = walkCycle(ring, ringPix, w, h);
  if (loop.length < 8) return null;
  const a = loop[0]!;
  const b = loop[Math.min(10, loop.length - 1)]!;
  const dx = (b % w) - (a % w);
  const dy = ((b / w) | 0) - ((a / w) | 0);
  if (dx > 1 || (dx >= 0 && dy <= 0)) {
    const rest = loop.slice(1);
    rest.reverse();
    loop = [loop[0]!, ...rest];
  }
  const order = loop.slice();
  if (stemPix.length > 3) {
    const stemPath = topToBottom(
      pathFromHighest(stemM, stemPix, w, h),
      w,
    );
    order.push(...stemPath);
  }
  return new Uint32Array(order);
}

function nearestInkAt(
  mask: Uint8Array,
  w: number,
  h: number,
  x: number,
  y: number,
  maxR: number,
  minY = 0,
): number {
  const cx = Math.round(x);
  const cy = Math.round(y);
  let best = -1;
  let bestD = 1e9;
  const rMax = Math.max(1, Math.round(maxR));
  for (let r = 0; r <= rMax; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const xx = cx + dx;
        const yy = cy + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        if (yy < minY) continue;
        const j = yy * w + xx;
        if (!mask[j]) continue;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = j;
        }
      }
    }
    if (best >= 0) return best;
  }
  return -1;
}

function traceToward(
  mask: Uint8Array,
  w: number,
  h: number,
  start: number,
  tx: number,
  ty: number,
): number[] {
  const path: number[] = [start];
  const used = new Uint8Array(mask.length);
  used[start] = 1;
  let cur = start;
  for (let step = 0; step < w + h; step++) {
    const x = cur % w;
    const y = (cur / w) | 0;
    const vx = tx - x;
    const vy = ty - y;
    if (vx * vx + vy * vy <= 2) break;
    let best = -1;
    let bestScore = -1e9;
    for (let d = 0; d < 8; d++) {
      const xx = x + DX[d]!;
      const yy = y + DY[d]!;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const j = yy * w + xx;
      if (!mask[j]) continue;
      const align = vx * DX[d]! + vy * DY[d]!;
      const fresh = used[j] ? -3 : 0;
      const score = align + fresh;
      if (score > bestScore) {
        bestScore = score;
        best = j;
      }
    }
    if (best < 0 || bestScore < 0) break;
    used[best] = 1;
    path.push(best);
    cur = best;
    if (cur === path[path.length - 2]) break;
  }
  return path;
}

function maskFromPath(
  path: number[],
  mask: Uint8Array,
  dist: Float32Array,
  w: number,
  h: number,
): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (const i of path) {
    const x = i % w;
    const y = (i / w) | 0;
    const r = Math.max(1, Math.ceil(dist[i]! * 1.12 + 0.8));
    for (let dy = -r; dy <= r; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= h) continue;
      const lim = Math.ceil(Math.sqrt(r * r - dy * dy));
      for (let dx = -lim; dx <= lim; dx++) {
        const xx = x + dx;
        if (xx < 0 || xx >= w) continue;
        const j = yy * w + xx;
        if (mask[j]) out[j] = 1;
      }
    }
  }
  return out;
}

function holeBounds(hole: Uint8Array, w: number, h: number) {
  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;
  for (let i = 0; i < hole.length; i++) {
    if (!hole[i]) continue;
    const x = i % w;
    const y = (i / w) | 0;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

function walkFrom(
  allow: Uint8Array,
  start: number,
  w: number,
  h: number,
  dx: number,
  dy: number,
): number[] {
  const visited = new Uint8Array(allow.length);
  const path: number[] = [];
  let cur = start;
  let prevDx = dx;
  let prevDy = dy;
  for (let step = 0; step < w + h && cur >= 0; step++) {
    path.push(cur);
    visited[cur] = 1;
    const next = pickAhead(allow, visited, cur, prevDx, prevDy, w, h);
    if (next < 0) break;
    prevDx = (next % w) - (cur % w);
    prevDy = ((next / w) | 0) - ((cur / w) | 0);
    cur = next;
  }
  return path;
}

function snapRegion(
  region: Uint8Array,
  w: number,
  h: number,
  x: number,
  y: number,
  maxR: number,
): number {
  const cx = Math.round(x);
  const cy = Math.round(y);
  let best = -1;
  let bestD = 1e9;
  const rMax = Math.max(1, Math.round(maxR));
  for (let r = 0; r <= rMax; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const xx = cx + dx;
        const yy = cy + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const j = yy * w + xx;
        if (!region[j]) continue;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = j;
        }
      }
    }
    if (best >= 0) return best;
  }
  return -1;
}

function polySnap(
  region: Uint8Array,
  w: number,
  h: number,
  box: { minX: number; minY: number; maxX: number; maxY: number },
  pts: Pt[],
): number[] {
  const bw = Math.max(1, box.maxX - box.minX);
  const bh = Math.max(1, box.maxY - box.minY);
  const maxR = Math.max(3, Math.round(Math.min(bw, bh) * 0.08));
  const mapped: Pt[] = pts.map(([u, v]) => [
    box.minX + u * bw,
    box.minY + v * bh,
  ]);
  const dense = resamplePts(mapped, 0.9);
  const out: number[] = [];
  for (const [x, y] of dense) {
    const j = snapRegion(region, w, h, x, y, maxR);
    if (j < 0) continue;
    if (out.length && out[out.length - 1] === j) continue;
    out.push(j);
  }
  return out;
}

function classifyA(
  mask: Uint8Array,
  w: number,
  h: number,
): { stemM: Uint8Array; bowlM: Uint8Array; box: ReturnType<typeof maskBBox> } {
  const box = maskBBox(mask, w, h);
  const bw = Math.max(1, box.maxX - box.minX);
  const bh = Math.max(1, box.maxY - box.minY);
  const splitX = box.minX + bw * 0.56;
  const hookY = box.minY + bh * 0.3;
  const hookX = box.minX + bw * 0.36;
  const stemM = new Uint8Array(mask.length);
  const bowlM = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const x = i % w;
    const y = (i / w) | 0;
    if (x >= splitX || (y <= hookY && x >= hookX)) stemM[i] = 1;
    else bowlM[i] = 1;
  }
  return { stemM, bowlM, box };
}

function paintLowerA(
  mask: Uint8Array,
  dist: Float32Array,
  w: number,
  h: number,
  maxR: number,
): number[] {
  const { stemM, bowlM, box } = classifyA(mask, w, h);
  const stem = polySnap(stemM, w, h, box, [
    [0.44, 0.22],
    [0.58, 0.14],
    [0.76, 0.13],
    [0.86, 0.22],
    [0.88, 0.45],
    [0.88, 0.72],
    [0.86, 0.96],
    [0.72, 0.9],
  ]);
  const PI = Math.PI;
  const bowlPts: Pt[] = arcPts(0.36, 0.5, 0.3, 0.36, -0.2 * PI, -0.2 * PI - 1.55 * PI, 28);
  const bowl = polySnap(bowlM, w, h, box, bowlPts);
  const a =
    stem.length > 2
      ? brushAlong(new Uint32Array(stem), stemM, dist, w, h, maxR)
      : [];
  const b =
    bowl.length > 2
      ? brushAlong(new Uint32Array(bowl), bowlM, dist, w, h, maxR)
      : [];
  return a.concat(b);
}

function spineOpenCurve(
  mask: Uint8Array,
  w: number,
  h: number,
  prefer: "topRight" | "topLeft",
): Uint32Array | null {
  const slim = thinMask(mask, w, h);
  const minSpur = Math.max(3, Math.round(Math.min(w, h) * 0.06));
  const pruned = pruneSpurs(slim, w, h, minSpur);
  const pix: number[] = [];
  for (let i = 0; i < pruned.length; i++) if (pruned[i]) pix.push(i);
  if (pix.length < 6) return null;
  const ends = pix.filter((i) => degreeAt(pruned, i, w, h) === 1);
  const cands = ends.length >= 2 ? ends : pix;
  let start = cands[0]!;
  for (const i of cands) {
    const x = i % w;
    const y = (i / w) | 0;
    const sx = start % w;
    const sy = (start / w) | 0;
    if (prefer === "topRight") {
      if (y < sy - 1 || (Math.abs(y - sy) <= 2 && x > sx)) start = i;
    } else if (y < sy - 1 || (Math.abs(y - sy) <= 2 && x < sx)) start = i;
  }
  const { far, prev } = bfsFar(start, pruned, w, h);
  const path = reconstruct(prev, start, far);
  if (path.length < 6) return null;
  return new Uint32Array(path);
}

function glyphSpine(
  mask: Uint8Array,
  dist: Float32Array,
  w: number,
  h: number,
  ch: string,
): Uint32Array {
  if (ch === "S" || ch === "s") {
    const p = spineOpenCurve(mask, w, h, "topRight");
    if (p) return p;
  }
  if (ch === "U" || ch === "u") {
    const p = spineOpenCurve(mask, w, h, "topLeft");
    if (p) return p;
  }
  const tmpl = letterStrokes(ch);
  if (tmpl) {
    const path = spineFromTemplate(mask, w, h, tmpl);
    if (path.length > 4) return path;
  }
  const core = new Uint8Array(mask.length);
  let coreN = 0;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] && dist[i]! >= 0.85) {
      core[i] = 1;
      coreN++;
    }
  }
  const slim = thinMask(coreN > 8 ? core : mask, w, h);
  let ink = 0;
  for (let i = 0; i < slim.length; i++) if (slim[i]) ink++;
  const source = ink > 0 ? slim : mask;
  const minSpur = Math.max(4, Math.round(Math.min(w, h) * 0.12));
  const pruned = pruneSpurs(source, w, h, minSpur);
  const path = writeLetter(pruned, w, h, ch);
  return new Uint32Array(path);
}

function brushAlong(
  spine: Uint32Array,
  mask: Uint8Array,
  dist: Float32Array,
  w: number,
  h: number,
  maxR: number,
): number[] {
  if (spine.length === 0) {
    let best = -1;
    let bestD = -1;
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i]) continue;
      if (dist[i]! > bestD) {
        bestD = dist[i]!;
        best = i;
      }
    }
    if (best < 0) return [];
    spine = new Uint32Array([best]);
  }
  const used = new Uint8Array(mask.length);
  const stamps: number[][] = Array.from({ length: spine.length }, () => []);
  const keys: number[][] = Array.from({ length: spine.length }, () => []);
  let px = spine[0]! % w;
  let py = (spine[0]! / w) | 0;
  const sx = new Int32Array(spine.length);
  const sy = new Int32Array(spine.length);
  const txa = new Int32Array(spine.length);
  const tya = new Int32Array(spine.length);
  for (let k = 0; k < spine.length; k++) {
    const i = spine[k]!;
    const x = i % w;
    const y = (i / w) | 0;
    sx[k] = x;
    sy[k] = y;
    let tx = x - px;
    let ty = y - py;
    if (tx === 0 && ty === 0) {
      tx = 1;
      ty = 0;
    }
    txa[k] = tx;
    tya[k] = ty;
    const r = Math.max(1, Math.min(maxR, Math.ceil(dist[i]! * 1.4 + 1.8)));
    const r2 = r * r;
    const stamp = stamps[k]!;
    const key = keys[k]!;
    stamp.push(i);
    key.push(-1e6);
    if (mask[i] && !used[i]) used[i] = 1;
    for (let dy = -r; dy <= r; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= h) continue;
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r2) continue;
        const xx = x + dx;
        if (xx < 0 || xx >= w) continue;
        const j = yy * w + xx;
        if (used[j] || !mask[j]) continue;
        used[j] = 1;
        stamp.push(j);
        key.push(dx * tx + dy * ty);
      }
    }
    px = x;
    py = y;
  }
  for (let j = 0; j < mask.length; j++) {
    if (!mask[j] || used[j]) continue;
    const x = j % w;
    const y = (j / w) | 0;
    let best = 0;
    let bestD = 1e15;
    for (let k = 0; k < spine.length; k++) {
      const dx = x - sx[k]!;
      const dy = y - sy[k]!;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    used[j] = 1;
    stamps[best]!.push(j);
    keys[best]!.push((x - sx[best]!) * txa[best]! + (y - sy[best]!) * tya[best]!);
  }
  const out: number[] = [];
  for (let k = 0; k < stamps.length; k++) {
    const stamp = stamps[k]!;
    const key = keys[k]!;
    for (let a = 1; a < stamp.length; a++) {
      const jv = stamp[a]!;
      const kv = key[a]!;
      let b = a;
      while (b > 0 && key[b - 1]! > kv) {
        stamp[b] = stamp[b - 1]!;
        key[b] = key[b - 1]!;
        b--;
      }
      stamp[b] = jv;
      key[b] = kv;
    }
    for (let a = 0; a < stamp.length; a++) out.push(stamp[a]!);
  }
  return out;
}

function mapToGlobal(
  local: number[],
  lw: number,
  ox: number,
  oy: number,
  gw: number,
  gh: number,
): number[] {
  const out: number[] = [];
  for (const i of local) {
    const x = (i % lw) + ox;
    const y = ((i / lw) | 0) + oy;
    if (x < 0 || y < 0 || x >= gw || y >= gh) continue;
    out.push(y * gw + x);
  }
  return out;
}

function splitGlyphDots(
  mask: Uint8Array,
  w: number,
  h: number,
  ch = "",
): { body: Uint8Array; dots: number[][] } {
  const seen = new Uint8Array(mask.length);
  const comps: number[][] = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || seen[i]) continue;
    comps.push(floodComponent(mask, i, w, h, seen));
  }
  comps.sort((a, b) => b.length - a.length);
  const body = new Uint8Array(mask.length);
  const dots: number[][] = [];
  if (!comps.length) return { body, dots };
  const box = maskBBox(mask, w, h);
  const gh = Math.max(1, box.maxY - box.minY);
  const topCut = box.minY + gh * 0.5;
  const main = comps[0]!;
  const umlaut = "äöüÄÖÜïë".includes(ch);
  for (const p of main) body[p] = 1;
  for (let c = 1; c < comps.length; c++) {
    const chunk = comps[c]!;
    const b = chunkBBox(chunk, w);
    const high = b.maxY <= topCut;
    const small =
      chunk.length < main.length * 0.18 &&
      Math.max(b.bw, b.bh) < gh * 0.32;
    if (high && (umlaut || small || isDot(chunk, w, gh))) dots.push(chunk);
    else for (const p of chunk) body[p] = 1;
  }
  dots.sort((a, b) => chunkBBox(a, w).minX - chunkBBox(b, w).minX);
  return { body, dots };
}

function glyphMetrics(
  ctx: CanvasRenderingContext2D,
  ch: string,
  fontPx: number,
) {
  const m = ctx.measureText(ch);
  const left = Math.ceil(Math.max(0, m.actualBoundingBoxLeft || 0));
  const right = Math.ceil(
    Math.max(m.width, m.actualBoundingBoxRight || m.width, 1),
  );
  const ascent = Math.ceil(
    Math.max(fontPx * 0.95, m.actualBoundingBoxAscent || fontPx * 0.8),
  );
  const descent = Math.ceil(
    Math.max(fontPx * 0.3, m.actualBoundingBoxDescent || fontPx * 0.25),
  );
  const adv = Math.ceil(Math.max(m.width, right) + fontPx * 0.05);
  return { left, right, ascent, descent, adv, width: m.width };
}

export async function analyzeText(
  spec: TextSpec,
  params: AnalyzeParams,
): Promise<{ job: GraphiteJob; thumb: string }> {
  const content = spec.content.replace(/\r\n/g, "\n").replace(/\s+$/g, "");
  const lines = (content || " ").split("\n").slice(0, 24);
  const maxSize = Math.max(128, params.maxSize);
  let fontPx = Math.max(32, Math.min(maxSize, Math.round(maxSize * 0.48)));
  await loadFont(spec, fontPx);

  const probe = document.createElement("canvas").getContext("2d");
  if (!probe) throw new Error("Canvas nicht verfügbar");

  const fit = async () => {
    await loadFont(spec, fontPx);
    probe.font = cssFont(spec, fontPx);
    const pad = Math.ceil(fontPx * 0.22);
    const lineStep = fontPx * 1.38;
    let longest = 1;
    for (const line of lines) {
      let x = 0;
      for (const ch of line) {
        if (ch === " " || ch === "\t") {
          x += probe.measureText(" ").width;
          continue;
        }
        x += glyphMetrics(probe, ch, fontPx).adv;
      }
      longest = Math.max(longest, x);
    }
    return {
      pad,
      lineStep,
      width: Math.ceil(longest + pad * 2),
      height: Math.ceil(lines.length * lineStep + pad * 2),
    };
  };

  let layout = await fit();
  const box = () => Math.max(layout.width, layout.height);
  if (box() > maxSize) {
    fontPx = Math.max(20, Math.floor(fontPx * (maxSize / box()) * 0.98));
    layout = await fit();
  } else if (box() < maxSize * 0.92) {
    fontPx = Math.max(20, Math.min(maxSize, Math.floor(fontPx * (maxSize / box()) * 0.98)));
    layout = await fit();
    if (box() > maxSize) {
      fontPx = Math.max(20, Math.floor(fontPx * (maxSize / box()) * 0.98));
      layout = await fit();
    }
  }
  const { pad: pad2, lineStep } = layout;
  const width = Math.max(8, Math.min(maxSize, layout.width));
  const height = Math.max(8, Math.min(maxSize, layout.height));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas nicht verfügbar");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  const tr = ctx as CanvasRenderingContext2D & { textRendering?: string };
  if (typeof tr.textRendering === "string" || "textRendering" in ctx) {
    tr.textRendering = "geometricPrecision";
  }
  ctx.fillStyle = `rgb(${STAGE_PAPER[0]} ${STAGE_PAPER[1]} ${STAGE_PAPER[2]})`;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "rgb(22 18 16)";
  ctx.font = cssFont(spec, fontPx);
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  const baseline0 = pad2 + fontPx * 0.95;
  lines.forEach((line, i) => {
    let x = pad2;
    const y = Math.round(baseline0 + i * lineStep);
    ctx.font = cssFont(spec, fontPx);
    for (const ch of line) {
      if (ch === " " || ch === "\t") {
        x += ctx.measureText(" ").width;
        continue;
      }
      const m = glyphMetrics(ctx, ch, fontPx);
      ctx.fillText(ch, Math.round(x), y);
      x += m.adv;
    }
  });
  const rgba = ctx.getImageData(0, 0, width, height).data;
  const gray = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = Math.round(
      0.2126 * rgba[p]! + 0.7152 * rgba[p + 1]! + 0.0722 * rgba[p + 2]!,
    );
  }

  const order: number[] = [];
  const maxR = Math.max(2, Math.round(fontPx * 0.28));
  const glyphPad = Math.max(2, Math.ceil(fontPx * 0.12));

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]!;
    let xCursor = pad2;
    const baseline = baseline0 + li * lineStep;
    for (const ch of line) {
      ctx.font = cssFont(spec, fontPx);
      if (ch === " " || ch === "\t") {
        xCursor += ctx.measureText(" ").width;
        continue;
      }
      const m = glyphMetrics(ctx, ch, fontPx);
      const gw = Math.max(8, m.left + m.right + glyphPad * 2);
      const gh = Math.max(8, m.ascent + m.descent + glyphPad * 2);
      const off = document.createElement("canvas");
      off.width = gw;
      off.height = gh;
      const octx = off.getContext("2d", { willReadFrequently: true });
      if (!octx) {
        xCursor += m.adv;
        continue;
      }
      octx.fillStyle = "#fff";
      octx.fillRect(0, 0, gw, gh);
      octx.fillStyle = "#000";
      octx.font = cssFont(spec, fontPx);
      octx.textBaseline = "alphabetic";
      const drawX = Math.round(glyphPad + m.left);
      const drawY = Math.round(glyphPad + m.ascent);
      octx.fillText(ch, drawX, drawY);
      const pix = octx.getImageData(0, 0, gw, gh).data;
      const mask = new Uint8Array(gw * gh);
      for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
        const g = 0.2126 * pix[p]! + 0.7152 * pix[p + 1]! + 0.0722 * pix[p + 2]!;
        if (g < 200) mask[i] = 1;
      }
      const { body, dots } = splitGlyphDots(mask, gw, gh, ch);
      const dist = chamferDistance(body, gw, gh);
      const tmpl = (letterStrokes(ch) ?? []).filter((s) => s.length >= 2);
      const multi = tmpl.length > 1;
      let local: number[];
      if (ch === "a" || ch === "ä") {
        local = paintLowerA(body, dist, gw, gh, maxR);
      } else if (multi) {
        local = paintFromTemplate(body, dist, gw, gh, maxR, tmpl);
      } else {
        local = brushAlong(
          glyphSpine(body, dist, gw, gh, ch),
          body,
          dist,
          gw,
          gh,
          maxR,
        );
      }
      for (const dot of dots) local = local.concat(dot);
      const ox = Math.round(xCursor - drawX);
      const oy = Math.round(baseline - drawY);
      const mapped = mapToGlobal(local, gw, ox, oy, width, height);
      const seen = new Set<number>();
      for (const j of mapped) {
        if (seen.has(j)) continue;
        seen.add(j);
        order.push(j);
      }
      xCursor += m.adv;
    }
  }

  const lineOrder = new Uint32Array(order);
  const paper: [number, number, number, number] = [
    STAGE_PAPER[0],
    STAGE_PAPER[1],
    STAGE_PAPER[2],
    255,
  ];
  const job: GraphiteJob = {
    width,
    height,
    rgba: new Uint8ClampedArray(rgba),
    gray,
    lineOrder,
    toneOrder: new Uint32Array(0),
    layers: [],
    pixelLevel: new Uint8Array(width * height),
    paper,
    ink: [28, 24, 20, 255],
  };
  const thumb = canvas.toDataURL("image/png");
  return { job, thumb };
}
