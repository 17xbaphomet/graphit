import type {
  AnalyzeParams,
  ExportMaster,
  MasterableKey,
  Plate,
  PlateOverrides,
  Timeline,
} from "./types";
import { DEFAULT_OVERRIDES } from "./types";
import { textWriteMs } from "./text";

export function sameParams(a: AnalyzeParams, b: AnalyzeParams): boolean {
  return (
    a.maxSize === b.maxSize &&
    a.edgeThreshold === b.edgeThreshold &&
    a.inkThreshold === b.inkThreshold &&
    a.includeInk === b.includeInk &&
    a.minStroke === b.minStroke &&
    a.levels === b.levels
  );
}

function overridesOf(plate: Plate): PlateOverrides {
  return plate.overrides ?? DEFAULT_OVERRIDES;
}

export function resolvedParams(plate: Plate, master: ExportMaster): AnalyzeParams {
  const o = overridesOf(plate);
  return {
    maxSize: o.maxSize ? plate.params.maxSize : master.params.maxSize,
    edgeThreshold: o.edgeThreshold
      ? plate.params.edgeThreshold
      : master.params.edgeThreshold,
    inkThreshold: o.inkThreshold
      ? plate.params.inkThreshold
      : master.params.inkThreshold,
    includeInk: o.includeInk ? plate.params.includeInk : master.params.includeInk,
    minStroke: o.minStroke ? plate.params.minStroke : master.params.minStroke,
    levels: o.levels ? plate.params.levels : master.params.levels,
  };
}

export function resolvedTimeline(plate: Plate, master: ExportMaster): Timeline {
  const o = overridesOf(plate);
  if (plate.kind === "text") {
    const pixels = plate.job?.lineOrder.length ?? 0;
    return {
      lineMs: pixels
        ? textWriteMs(pixels, plate.text?.speed ?? 1)
        : o.lineMs
          ? plate.timeline.lineMs
          : master.timeline.lineMs,
      toneMs: 0,
      holdMs: o.holdMs ? plate.timeline.holdMs : master.timeline.holdMs,
    };
  }
  return {
    lineMs: o.lineMs ? plate.timeline.lineMs : master.timeline.lineMs,
    toneMs: o.toneMs ? plate.timeline.toneMs : master.timeline.toneMs,
    holdMs: o.holdMs ? plate.timeline.holdMs : master.timeline.holdMs,
  };
}

export function resolvedTransparency(plate: Plate, master: ExportMaster): number {
  return overridesOf(plate).transparency
    ? plate.transparency
    : master.transparency;
}

export function resolvePlate(plate: Plate, master: ExportMaster): Plate {
  return {
    ...plate,
    overrides: overridesOf(plate),
    params: resolvedParams(plate, master),
    timeline: resolvedTimeline(plate, master),
    transparency: resolvedTransparency(plate, master),
  };
}

export function resolvePlates(plates: Plate[], master: ExportMaster): Plate[] {
  return plates.map((plate) => resolvePlate(plate, master));
}

export function applyOverride(
  plate: Plate,
  master: ExportMaster,
  key: MasterableKey,
  on: boolean,
): Pick<Plate, "overrides" | "params" | "timeline" | "transparency"> {
  const overrides = { ...overridesOf(plate), [key]: on };
  if (!on) {
    return {
      overrides,
      params: plate.params,
      timeline: plate.timeline,
      transparency: plate.transparency,
    };
  }
  const params = { ...plate.params };
  const timeline = { ...plate.timeline };
  let transparency = plate.transparency;
  switch (key) {
    case "lineMs":
      timeline.lineMs = master.timeline.lineMs;
      break;
    case "toneMs":
      timeline.toneMs = master.timeline.toneMs;
      break;
    case "holdMs":
      timeline.holdMs = master.timeline.holdMs;
      break;
    case "transparency":
      transparency = master.transparency;
      break;
    case "maxSize":
      params.maxSize = master.params.maxSize;
      break;
    case "levels":
      params.levels = master.params.levels;
      break;
    case "edgeThreshold":
      params.edgeThreshold = master.params.edgeThreshold;
      break;
    case "inkThreshold":
      params.inkThreshold = master.params.inkThreshold;
      break;
    case "minStroke":
      params.minStroke = master.params.minStroke;
      break;
    case "includeInk":
      params.includeInk = master.params.includeInk;
      break;
  }
  return { overrides, params, timeline, transparency };
}
