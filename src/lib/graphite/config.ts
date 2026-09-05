import type { ExportMaster, Plate, StageSize } from "./types";
import { resolvePlates } from "./master";

export type GraphitConfig = {
  version: 1;
  stage: StageSize;
  fps: number;
  paper?: [number, number, number];
  master: {
    maxSize: number;
    edgeThreshold: number;
    inkThreshold: number;
    includeInk: boolean;
    minStroke: number;
    levels: number;
    lineMs: number;
    toneMs: number;
    holdMs: number;
    transparency: number;
  };
  plates: GraphitPlateConfig[];
};

export type GraphitPlateConfig = {
  image?: number;
  kind: "image" | "text";
  name: string;
  frame: { x: number; y: number; w: number; h: number };
  startMs: number;
  maxSize?: number;
  edgeThreshold?: number;
  inkThreshold?: number;
  includeInk?: boolean;
  minStroke?: number;
  levels?: number;
  lineMs?: number;
  toneMs?: number;
  holdMs?: number;
  transparency?: number;
  text?: {
    content: string;
    fontFamily: string;
    fontWeight: number;
    italic: boolean;
    speed: number;
  };
};

export function compositionToConfig(
  stage: StageSize,
  plates: Plate[],
  master: ExportMaster,
  fps = 30,
): GraphitConfig {
  const resolved = resolvePlates(plates, master);
  let imageIndex = 0;
  const out: GraphitPlateConfig[] = resolved.map((plate) => {
    const item: GraphitPlateConfig = {
      kind: plate.kind === "text" ? "text" : "image",
      name: plate.name,
      frame: { ...plate.frame },
      startMs: plate.startMs,
    };
    if (item.kind === "image") {
      item.image = imageIndex++;
    }
    const o = plate.overrides;
    if (o.maxSize) item.maxSize = plate.params.maxSize;
    if (o.edgeThreshold) item.edgeThreshold = plate.params.edgeThreshold;
    if (o.inkThreshold) item.inkThreshold = plate.params.inkThreshold;
    if (o.includeInk) item.includeInk = plate.params.includeInk;
    if (o.minStroke) item.minStroke = plate.params.minStroke;
    if (o.levels) item.levels = plate.params.levels;
    if (o.lineMs) item.lineMs = plate.timeline.lineMs;
    if (o.toneMs) item.toneMs = plate.timeline.toneMs;
    if (o.holdMs) item.holdMs = plate.timeline.holdMs;
    if (o.transparency) item.transparency = plate.transparency;
    if (plate.kind === "text" && plate.text) {
      item.text = { ...plate.text };
    }
    return item;
  });
  return {
    version: 1,
    stage: { width: stage.width, height: stage.height },
    fps,
    paper: [243, 238, 228],
    master: {
      maxSize: master.params.maxSize,
      edgeThreshold: master.params.edgeThreshold,
      inkThreshold: master.params.inkThreshold,
      includeInk: master.params.includeInk,
      minStroke: master.params.minStroke,
      levels: master.params.levels,
      lineMs: master.timeline.lineMs,
      toneMs: master.timeline.toneMs,
      holdMs: master.timeline.holdMs,
      transparency: master.transparency,
    },
    plates: out,
  };
}

export const EXAMPLE_CONFIG: GraphitConfig = {
  version: 1,
  stage: { width: 1280, height: 720 },
  fps: 30,
  paper: [243, 238, 228],
  master: {
    maxSize: 680,
    edgeThreshold: 16,
    inkThreshold: 38,
    includeInk: true,
    minStroke: 3,
    levels: 10,
    lineMs: 4800,
    toneMs: 7200,
    holdMs: 1600,
    transparency: 100,
  },
  plates: [
    {
      image: 0,
      kind: "image",
      name: "skizze",
      frame: { x: 0.04, y: 0.04, w: 0.92, h: 0.92 },
      startMs: 0,
    },
  ],
};
