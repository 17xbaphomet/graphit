import type { GraphiteJob, PhaseInfo, Timeline } from "./types";

function clamp01(x: number) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function easeInOutCubic(x: number) {
  const t = clamp01(x);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function tonePixelCount(job: GraphiteJob): number {
  return job.toneOrder.length;
}

export function tonePhaseMs(job: GraphiteJob, timeline: Timeline): number {
  return tonePixelCount(job) > 0 ? timeline.toneMs : 0;
}

export function totalDuration(job: GraphiteJob, timeline: Timeline): number {
  const line = job.lineOrder.length > 0 ? timeline.lineMs : 0;
  return line + tonePhaseMs(job, timeline) + timeline.holdMs;
}

function toneTarget(job: GraphiteJob, local: number): number {
  return easeInOutCubic(local) * tonePixelCount(job);
}

export function phaseAt(
  job: GraphiteJob,
  timeline: Timeline,
  tMs: number,
): PhaseInfo {
  const total = Math.max(1, totalDuration(job, timeline));
  const t = Math.min(Math.max(0, tMs), total);
  const lineMs = job.lineOrder.length > 0 ? timeline.lineMs : 0;
  const layerCount = job.layers.length;

  if (t < lineMs) {
    return {
      kind: "lines",
      label: "Linien",
      local: lineMs > 0 ? t / lineMs : 1,
      global: t / total,
      layerIndex: -1,
      layerCount,
    };
  }

  const afterLines = t - lineMs;
  const toneWindow = tonePhaseMs(job, timeline);
  if (toneWindow > 0 && afterLines < toneWindow) {
    const local = afterLines / toneWindow;
    const target = toneTarget(job, local);
    let acc = 0;
    let idx = 0;
    for (let i = 0; i < job.layers.length; i++) {
      acc += job.layers[i]!.pixels.length;
      idx = i;
      if (target < acc) break;
    }
    return {
      kind: "tones",
      label: `Ton ${idx + 1}`,
      local,
      global: t / total,
      layerIndex: idx,
      layerCount,
    };
  }

  return {
    kind: "hold",
    label: "Fertig",
    local: 1,
    global: t / total,
    layerIndex: layerCount,
    layerCount,
  };
}

function writePixel(
  dest: Uint8ClampedArray,
  i: number,
  r: number,
  g: number,
  b: number,
  a = 255,
) {
  const p = i * 4;
  if (a >= 255) {
    dest[p] = r;
    dest[p + 1] = g;
    dest[p + 2] = b;
    dest[p + 3] = 255;
    return;
  }
  const aa = a / 255;
  dest[p] = dest[p]! * (1 - aa) + r * aa;
  dest[p + 1] = dest[p + 1]! * (1 - aa) + g * aa;
  dest[p + 2] = dest[p + 2]! * (1 - aa) + b * aa;
  dest[p + 3] = 255;
}

function writeOriginal(
  dest: Uint8ClampedArray,
  src: Uint8ClampedArray,
  i: number,
) {
  const p = i * 4;
  dest[p] = src[p]!;
  dest[p + 1] = src[p + 1]!;
  dest[p + 2] = src[p + 2]!;
  dest[p + 3] = 255;
}

function fillPaper(
  dest: Uint8ClampedArray,
  paper: GraphiteJob["paper"],
  alpha = 1,
) {
  const a = Math.round(clamp01(alpha) * 255);
  for (let p = 0; p < dest.length; p += 4) {
    dest[p] = paper[0];
    dest[p + 1] = paper[1];
    dest[p + 2] = paper[2];
    dest[p + 3] = a;
  }
}

/** Fade paper-colored and near-white pixels so overlaps do not cover with white. */
export function knockPaper(
  dest: Uint8ClampedArray,
  _paper: GraphiteJob["paper"],
  amount: number,
) {
  const t = clamp01(amount);
  if (t <= 0) return;
  const lo = 255 - 125 * t;
  const hi = 255 - 8 * t;
  const span = Math.max(1, hi - lo);
  for (let p = 0; p < dest.length; p += 4) {
    const luma =
      0.2126 * dest[p]! + 0.7152 * dest[p + 1]! + 0.0722 * dest[p + 2]!;
    let fade = 0;
    if (luma >= hi) fade = 1;
    else if (luma > lo) fade = (luma - lo) / span;
    if (fade > 0) dest[p + 3] = Math.round(dest[p + 3]! * (1 - fade * t));
  }
}

function drawLines(
  dest: Uint8ClampedArray,
  job: GraphiteJob,
  count: number,
) {
  const ink = job.ink;
  const n = Math.min(count, job.lineOrder.length);
  for (let k = 0; k < n; k++) {
    writePixel(dest, job.lineOrder[k]!, ink[0], ink[1], ink[2]);
  }
}

function tonePenPixel(job: GraphiteJob, target: number): number {
  const n = Math.min(job.toneOrder.length, Math.max(0, Math.floor(target)));
  if (n <= 0) return -1;
  return job.toneOrder[n - 1]!;
}

function drawLineRange(
  dest: Uint8ClampedArray,
  job: GraphiteJob,
  from: number,
  to: number,
) {
  const ink = job.ink;
  const a = Math.max(0, from);
  const b = Math.min(job.lineOrder.length, to);
  for (let k = a; k < b; k++) {
    writePixel(dest, job.lineOrder[k]!, ink[0], ink[1], ink[2]);
  }
}

function drawToneRange(
  dest: Uint8ClampedArray,
  job: GraphiteJob,
  from: number,
  to: number,
) {
  const src = job.rgba;
  const pix = job.toneOrder;
  const a = Math.max(0, from);
  const b = Math.min(pix.length, to);
  for (let k = a; k < b; k++) {
    writeOriginal(dest, src, pix[k]!);
  }
}

function lineCountAt(job: GraphiteJob, phase: PhaseInfo): number {
  if (phase.kind === "lines") {
    return Math.floor(easeInOutCubic(phase.local) * job.lineOrder.length);
  }
  return job.lineOrder.length;
}

function toneCountAt(job: GraphiteJob, phase: PhaseInfo): number {
  if (phase.kind === "lines") return 0;
  if (phase.kind === "hold") return job.toneOrder.length;
  return Math.floor(toneTarget(job, phase.local));
}

export function paintFrame(
  dest: Uint8ClampedArray,
  job: GraphiteJob,
  timeline: Timeline,
  tMs: number,
  key = 0,
): PhaseInfo {
  const phase = phaseAt(job, timeline, tMs);
  fillPaper(dest, job.paper, 1 - key);

  if (phase.kind === "lines") {
    drawLineRange(dest, job, 0, lineCountAt(job, phase));
    return phase;
  }

  drawLineRange(dest, job, 0, job.lineOrder.length);

  if (phase.kind === "hold") {
    dest.set(job.rgba);
    knockPaper(dest, job.paper, key);
    return phase;
  }

  drawToneRange(dest, job, 0, toneCountAt(job, phase));
  if (key > 0) knockPaper(dest, job.paper, key);
  return phase;
}

function penAt(
  ctx: CanvasRenderingContext2D,
  job: GraphiteJob,
  pix: number,
) {
  const x = pix % job.width;
  const y = (pix / job.width) | 0;
  ctx.save();
  ctx.fillStyle = "rgba(22, 18, 14, 0.55)";
  ctx.beginPath();
  ctx.arc(x + 0.5, y + 0.5, 1.7, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export class GraphiteRenderer {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private image: ImageData;
  job: GraphiteJob;
  timeline: Timeline;
  private lastLine = -1;
  private lastTone = -1;
  private key = 0;

  constructor(canvas: HTMLCanvasElement, job: GraphiteJob, timeline: Timeline) {
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) throw new Error("Canvas nicht verfügbar");
    this.canvas = canvas;
    this.ctx = ctx;
    this.job = job;
    this.timeline = timeline;
    canvas.width = job.width;
    canvas.height = job.height;
    this.image = ctx.createImageData(job.width, job.height);
  }

  setKey(amount: number) {
    const next = clamp01(amount);
    if (Math.abs(next - this.key) < 0.001) return;
    this.key = next;
    this.lastLine = -1;
    this.lastTone = -1;
  }

  attach(job: GraphiteJob, timeline: Timeline) {
    this.job = job;
    this.timeline = timeline;
    this.lastLine = -1;
    this.lastTone = -1;
    if (
      this.canvas.width !== job.width ||
      this.canvas.height !== job.height
    ) {
      this.canvas.width = job.width;
      this.canvas.height = job.height;
      this.image = this.ctx.createImageData(job.width, job.height);
    }
  }

  draw(tMs: number): PhaseInfo {
    const phase = phaseAt(this.job, this.timeline, tMs);
    const lines = lineCountAt(this.job, phase);
    const tones = toneCountAt(this.job, phase);
    const dest = this.image.data;

    const canStep =
      this.lastLine >= 0 &&
      lines >= this.lastLine &&
      tones >= this.lastTone &&
      !(phase.kind === "hold" && this.lastTone < this.job.toneOrder.length);

    if (!canStep) {
      paintFrame(dest, this.job, this.timeline, tMs, this.key);
    } else {
      if (lines > this.lastLine) {
        drawLineRange(dest, this.job, this.lastLine, lines);
      }
      if (tones > this.lastTone) {
        drawToneRange(dest, this.job, this.lastTone, tones);
      }
      if (phase.kind === "hold") {
        dest.set(this.job.rgba);
        knockPaper(dest, this.job.paper, this.key);
      }
    }

    this.lastLine = lines;
    this.lastTone = tones;
    this.ctx.putImageData(this.image, 0, 0);

    if (phase.kind === "lines" && phase.local < 1 && this.job.lineOrder.length) {
      const idx = Math.min(this.job.lineOrder.length - 1, Math.max(0, lines - 1));
      penAt(this.ctx, this.job, this.job.lineOrder[idx]!);
    }

    if (phase.kind === "tones" && phase.local < 1) {
      const last = tonePenPixel(this.job, tones);
      if (last >= 0) penAt(this.ctx, this.job, last);
    }

    return phase;
  }

  drawLinesOnly() {
    this.lastLine = -1;
    this.lastTone = -1;
    fillPaper(this.image.data, this.job.paper, 1 - this.key);
    drawLines(this.image.data, this.job, this.job.lineOrder.length);
    this.ctx.putImageData(this.image, 0, 0);
  }

  drawOriginal() {
    this.lastLine = -1;
    this.lastTone = -1;
    this.image.data.set(this.job.rgba);
    knockPaper(this.image.data, this.job.paper, this.key);
    this.ctx.putImageData(this.image, 0, 0);
  }
}
