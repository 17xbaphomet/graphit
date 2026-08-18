export type AnalyzeParams = {
  maxSize: number;
  /** 0–100: share of peak Sobel magnitude treated as a line. */
  edgeThreshold: number;
  /** 0–255: pixels darker than this are inked as drawn strokes. */
  inkThreshold: number;
  includeInk: boolean;
  /** Drop line strokes shorter than this (pixels). */
  minStroke: number;
  /** Number of tone bins, darkest first. */
  levels: number;
};

export type ToneLayer = {
  /** Representative gray, 0 = black. */
  value: number;
  /** Pixel indices in drawing order (same stroke-tour as the lines). */
  pixels: Uint32Array;
};

export type GraphiteJob = {
  width: number;
  height: number;
  /** Original RGBA, length width * height * 4. */
  rgba: Uint8ClampedArray;
  /** Luminance 0–255 per pixel. */
  gray: Uint8Array;
  /** Pixel indices in drawing order. */
  lineOrder: Uint32Array;
  /** All tone pixels in draw order (darkest layer first). */
  toneOrder: Uint32Array;
  /** Darkest → lightest. */
  layers: ToneLayer[];
  /** Compact layer index per pixel (0 = darkest). */
  pixelLevel: Uint8Array;
  paper: [number, number, number, number];
  ink: [number, number, number, number];
};

export type Timeline = {
  lineMs: number;
  /** Duration to draw all tone levels, darkest first. */
  toneMs: number;
  holdMs: number;
};

export type FrameRect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type Plate = {
  id: string;
  name: string;
  source: File | string;
  thumb: string;
  frame: FrameRect;
  startMs: number;
  params: AnalyzeParams;
  timeline: Timeline;
  applied: AnalyzeParams;
  job: GraphiteJob | null;
  /** 0–100: paper and near-white become see-through so overlaps keep the drawing below. */
  transparency: number;
};

export type StageSize = {
  width: number;
  height: number;
};

export const STAGE_PRESETS = [
  { label: "HD", width: 1280, height: 720 },
  { label: "FHD", width: 1920, height: 1080 },
  { label: "QHD", width: 2560, height: 1440 },
  { label: "4K", width: 3840, height: 2160 },
] as const;

export const DEFAULT_STAGE: StageSize = { width: 1280, height: 720 };

export const STAGE_PAPER: [number, number, number, number] = [243, 238, 228, 255];

export type PhaseKind = "lines" | "tones" | "hold";

export type PhaseInfo = {
  kind: PhaseKind;
  label: string;
  /** 0–1 within this phase. */
  local: number;
  /** 0–1 over the whole clip. */
  global: number;
  layerIndex: number;
  layerCount: number;
};

export const DEFAULT_PARAMS: AnalyzeParams = {
  maxSize: 680,
  edgeThreshold: 16,
  inkThreshold: 38,
  includeInk: true,
  minStroke: 3,
  levels: 10,
};

/** Pixels brighter than this are not painted in the line phase. */
export const LINE_MARK_MAX = 158;

export const DEFAULT_TIMELINE: Timeline = {
  lineMs: 4800,
  toneMs: 7200,
  holdMs: 1600,
};
