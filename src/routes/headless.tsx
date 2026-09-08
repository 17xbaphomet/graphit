import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { analyzeRaster, loadRaster } from "@/lib/graphite/analyze";
import { exportCompositionWebM } from "@/lib/graphite/export";
import {
  DEFAULT_OVERRIDES,
  DEFAULT_PARAMS,
  type AnalyzeParams,
  type Plate,
} from "@/lib/graphite/types";

export const Route = createFileRoute("/headless")({
  component: HeadlessExport,
});

type PlateSpec = {
  name: string;
  dataUrl: string;
  frame: { x: number; y: number; w: number; h: number };
  startMs?: number;
  lineMs?: number;
  toneMs?: number;
  holdMs?: number;
  maxSize?: number;
  transparency?: number;
};

type ExportSpec = {
  stage?: { width: number; height: number };
  plates: PlateSpec[];
};

function HeadlessExport() {
  useEffect(() => {
    const w = window as Window & {
      __graphitReady?: boolean;
      __graphitExport?: (spec: ExportSpec) => Promise<string>;
    };
    w.__graphitExport = async (spec: ExportSpec) => {
      const plates: Plate[] = [];
      for (const item of spec.plates || []) {
        const maxSize = item.maxSize || DEFAULT_PARAMS.maxSize;
        const raster = await loadRaster(item.dataUrl, maxSize);
        const params: AnalyzeParams = { ...DEFAULT_PARAMS, maxSize };
        const job = analyzeRaster(
          raster.width,
          raster.height,
          raster.data,
          params,
        );
        plates.push({
          id: item.name,
          name: item.name,
          source: item.dataUrl,
          thumb: "",
          frame: item.frame,
          startMs: item.startMs || 0,
          params,
          timeline: {
            lineMs: item.lineMs ?? 4000,
            toneMs: item.toneMs ?? 1500,
            holdMs: item.holdMs ?? 1000,
          },
          applied: params,
          job,
          transparency: item.transparency ?? 100,
          overrides: { ...DEFAULT_OVERRIDES },
          kind: "image",
        });
      }
      const blob = await exportCompositionWebM(
        spec.stage || { width: 1920, height: 1080 },
        plates,
      );
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("read failed"));
        reader.readAsDataURL(blob);
      });
    };
    w.__graphitReady = true;
  }, []);
  return <div id="graphit-headless">headless</div>;
}
