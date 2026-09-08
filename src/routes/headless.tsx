import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { loadRaster } from "@/lib/graphite/analyze";
import { analyzeRasterOffthread } from "@/lib/graphite/pool";
import { exportCompositionWebM } from "@/lib/graphite/export";
import type { GraphitConfig } from "@/lib/graphite/config";
import type { Plate } from "@/lib/graphite/types";
import {
  DEFAULT_OVERRIDES,
  DEFAULT_PARAMS,
  DEFAULT_TIMELINE,
} from "@/lib/graphite/types";

export const Route = createFileRoute("/headless")({
  component: HeadlessExport,
});

type JobIn = {
  config: GraphitConfig;
  images: string[];
};

async function runExport(input: JobIn): Promise<ArrayBuffer> {
  const cfg = input.config;
  const master = cfg.master;
  const plates: Plate[] = [];
  for (let i = 0; i < (cfg.plates || []).length; i++) {
    const spec = cfg.plates[i]!;
    if (spec.kind === "text") continue;
    const src = input.images[spec.image ?? 0];
    if (!src) continue;
    const maxSize = spec.maxSize ?? master.maxSize ?? DEFAULT_PARAMS.maxSize;
    const raster = await loadRaster(src, maxSize);
    const params = {
      maxSize,
      edgeThreshold: spec.edgeThreshold ?? master.edgeThreshold ?? DEFAULT_PARAMS.edgeThreshold,
      inkThreshold: spec.inkThreshold ?? master.inkThreshold ?? DEFAULT_PARAMS.inkThreshold,
      includeInk: spec.includeInk ?? master.includeInk ?? DEFAULT_PARAMS.includeInk,
      minStroke: spec.minStroke ?? master.minStroke ?? DEFAULT_PARAMS.minStroke,
      levels: spec.levels ?? master.levels ?? DEFAULT_PARAMS.levels,
    };
    const job = await analyzeRasterOffthread(
      raster.width,
      raster.height,
      raster.data,
      params,
    );
    plates.push({
      id: `p${i}`,
      name: spec.name || `plate-${i}`,
      source: src,
      thumb: src,
      frame: spec.frame,
      startMs: spec.startMs || 0,
      params,
      timeline: {
        lineMs: spec.lineMs ?? master.lineMs ?? DEFAULT_TIMELINE.lineMs,
        toneMs: spec.toneMs ?? master.toneMs ?? DEFAULT_TIMELINE.toneMs,
        holdMs: spec.holdMs ?? master.holdMs ?? DEFAULT_TIMELINE.holdMs,
      },
      applied: params,
      job,
      transparency: spec.transparency ?? master.transparency ?? 100,
      overrides: { ...DEFAULT_OVERRIDES },
      kind: "image",
    });
  }
  if (!plates.length) throw new Error("no image plates");
  const blob = await exportCompositionWebM(cfg.stage || { width: 1920, height: 1080 }, plates);
  return blob.arrayBuffer();
}

function HeadlessExport() {
  useEffect(() => {
    const w = window as Window & {
      __graphitReady?: boolean;
      __graphitExport?: (input: JobIn) => Promise<number[]>;
    };
    w.__graphitExport = async (input: JobIn) => {
      const buf = await runExport(input);
      return Array.from(new Uint8Array(buf));
    };
    w.__graphitReady = true;
  }, []);
  return (
    <div data-graphit-headless="1" style={{ padding: 16, fontFamily: "sans-serif" }}>
      graphit headless export
    </div>
  );
}
