import { compositionDuration } from "./compose";
import { resolvePlates } from "./master";
import type {
  ExportMaster,
  Plate,
  RenderQueueItem,
  StageSize,
} from "./types";

function clonePlate(plate: Plate): Plate {
  return {
    ...plate,
    params: { ...plate.params },
    timeline: { ...plate.timeline },
    applied: { ...plate.applied },
    overrides: { ...plate.overrides },
    frame: { ...plate.frame },
  };
}

function compositionName(plates: Plate[]): string {
  if (plates.length === 0) return "Komposition";
  if (plates.length === 1) return plates[0]!.name;
  if (plates.length === 2) return `${plates[0]!.name} · ${plates[1]!.name}`;
  return `${plates[0]!.name} +${plates.length - 1}`;
}

export function snapshotComposition(
  stage: StageSize,
  plates: Plate[],
  master: ExportMaster,
): RenderQueueItem {
  const frozen = resolvePlates(plates, master).map(clonePlate);
  return {
    id: `q-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: compositionName(frozen),
    createdAt: Date.now(),
    stage: { ...stage },
    plates: frozen,
    status: "queued",
    progress: 0,
  };
}

export function queueItemDuration(item: RenderQueueItem): number {
  return compositionDuration(item.plates);
}

export function fileSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return slug || "graphit";
}
