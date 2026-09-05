import { GraphiteRenderer, phaseAt, totalDuration } from "./render";
import type {
  FrameRect,
  GraphiteJob,
  PhaseInfo,
  Plate,
  StageSize,
  Timeline,
} from "./types";
import { STAGE_PAPER } from "./types";

export function plateDuration(plate: Plate): number {
  if (plate.job) return totalDuration(plate.job, plate.timeline);
  return plate.timeline.lineMs + plate.timeline.toneMs + plate.timeline.holdMs;
}

export function compositionDuration(plates: Plate[]): number {
  let max = 0;
  for (const plate of plates) {
    max = Math.max(max, plate.startMs + plateDuration(plate));
  }
  return Math.max(1, max);
}

export function compositionPhase(plates: Plate[], tMs: number): PhaseInfo | null {
  let active: { plate: Plate; info: PhaseInfo } | null = null;
  for (const plate of plates) {
    if (!plate.job) continue;
    const local = tMs - plate.startMs;
    if (local < 0) continue;
    const info = phaseAt(plate.job, plate.timeline, local);
    if (info.kind !== "hold" || !active) {
      active = { plate, info };
    }
  }
  if (!active) return null;
  const idx = plates.indexOf(active.plate) + 1;
  return {
    ...active.info,
    label: `${idx} · ${active.plate.name} · ${active.info.label}`,
  };
}

export function suggestFrame(existing: FrameRect[]): FrameRect {
  const n = existing.length;
  if (n === 0) return { x: 0.04, y: 0.04, w: 0.92, h: 0.92 };
  const col = n % 2;
  const row = Math.floor(n / 2) % 2;
  return clampFrame({
    x: 0.06 + col * 0.46,
    y: 0.08 + row * 0.42,
    w: 0.42,
    h: 0.46,
  });
}

export function nextStartMs(plates: Plate[]): number {
  if (plates.length === 0) return 0;
  return plates.reduce(
    (max, plate) => Math.max(max, plate.startMs + plateDuration(plate)),
    0,
  );
}

export function clampFrame(frame: FrameRect): FrameRect {
  const min = 0.08;
  const max = 2.5;
  const w = Math.min(max, Math.max(min, frame.w));
  const h = Math.min(max, Math.max(min, frame.h));
  const keep = 0.05;
  const x = Math.min(1 - keep, Math.max(keep - w, frame.x));
  const y = Math.min(1 - keep, Math.max(keep - h, frame.y));
  return { x, y, w, h };
}

function blitContain(
  ctx: CanvasRenderingContext2D,
  src: HTMLCanvasElement,
  fx: number,
  fy: number,
  fw: number,
  fh: number,
) {
  if (src.width < 1 || src.height < 1 || fw < 1 || fh < 1) return;
  const scale = Math.min(fw / src.width, fh / src.height);
  const dw = src.width * scale;
  const dh = src.height * scale;
  const dx = fx + (fw - dw) / 2;
  const dy = fy + (fh - dh) / 2;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, dx, dy, dw, dh);
}

export class StageRenderer {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly plates = new Map<string, GraphiteRenderer>();
  stage: StageSize;

  constructor(canvas: HTMLCanvasElement, stage: StageSize) {
    const ctx =
      canvas.getContext("2d", { alpha: false, desynchronized: true }) ??
      canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas nicht verfügbar");
    this.canvas = canvas;
    this.ctx = ctx;
    this.stage = stage;
    this.resize(stage);
  }

  resize(stage: StageSize) {
    this.stage = stage;
    if (this.canvas.width !== stage.width || this.canvas.height !== stage.height) {
      this.canvas.width = stage.width;
      this.canvas.height = stage.height;
    }
  }

  syncPlate(id: string, job: GraphiteJob, timeline: Timeline) {
    const existing = this.plates.get(id);
    if (existing) {
      existing.attach(job, timeline);
      return;
    }
    const off = document.createElement("canvas");
    this.plates.set(id, new GraphiteRenderer(off, job, timeline));
  }

  dropPlate(id: string) {
    this.plates.delete(id);
  }

  prune(ids: Set<string>) {
    for (const id of this.plates.keys()) {
      if (!ids.has(id)) this.plates.delete(id);
    }
  }

  draw(
    plates: Plate[],
    tMs: number,
    mode: "animation" | "lines" | "original",
  ): PhaseInfo | null {
    const { width, height } = this.stage;
    const ctx = this.ctx;
    ctx.fillStyle = `rgb(${STAGE_PAPER[0]} ${STAGE_PAPER[1]} ${STAGE_PAPER[2]})`;
    ctx.fillRect(0, 0, width, height);

    const live = new Set<string>();
    for (const plate of plates) {
      if (!plate.job) continue;
      live.add(plate.id);
      this.syncPlate(plate.id, plate.job, plate.timeline);
      const renderer = this.plates.get(plate.id);
      if (!renderer) continue;
      renderer.setKey((plate.transparency ?? 100) / 100);

      if (mode === "lines") {
        renderer.drawLinesOnly();
      } else if (mode === "original") {
        renderer.drawOriginal();
      } else {
        const local = tMs - plate.startMs;
        if (local < 0) continue;
        renderer.draw(local);
      }

      const fx = plate.frame.x * width;
      const fy = plate.frame.y * height;
      const fw = plate.frame.w * width;
      const fh = plate.frame.h * height;
      blitContain(ctx, renderer.canvas, fx, fy, fw, fh);
    }
    this.prune(live);
    return mode === "animation" ? compositionPhase(plates, tMs) : null;
  }
}
