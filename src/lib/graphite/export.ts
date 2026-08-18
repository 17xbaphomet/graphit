import type { Plate, StageSize } from "./types";
import { GraphiteRenderer, totalDuration } from "./render";
import { StageRenderer, compositionDuration } from "./compose";

function pickMime(): string {
  const types = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  for (const t of types) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) {
      return t;
    }
  }
  return "video/webm";
}

async function recordCanvas(
  canvas: HTMLCanvasElement,
  duration: number,
  pixels: number,
  draw: (t: number) => void,
  onProgress?: (ratio: number) => void,
): Promise<Blob> {
  if (typeof MediaRecorder === "undefined") {
    throw new Error("Videoexport wird von diesem Browser nicht unterstützt");
  }
  const fps = 30;
  const frames = Math.max(1, Math.ceil((duration / 1000) * fps));
  const mime = pickMime();
  const stream = canvas.captureStream(fps);
  const bitrate = Math.min(
    48_000_000,
    Math.max(6_000_000, Math.round(pixels * 2.4)),
  );
  const recorder = new MediaRecorder(stream, {
    mimeType: mime,
    videoBitsPerSecond: bitrate,
  });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  const stopped = new Promise<void>((resolve, reject) => {
    recorder.onstop = () => resolve();
    recorder.onerror = () => reject(new Error("Aufnahme fehlgeschlagen"));
  });

  recorder.start(200);
  for (let f = 0; f <= frames; f++) {
    const t = (f / frames) * duration;
    draw(t);
    onProgress?.(f / frames);
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  }

  if (recorder.state !== "inactive") recorder.stop();
  await stopped;
  stream.getTracks().forEach((tr) => tr.stop());

  if (chunks.length === 0) {
    throw new Error("Die Aufnahme ist leer");
  }
  return new Blob(chunks, { type: mime.split(";")[0] });
}

export async function exportWebM(
  job: import("./types").GraphiteJob,
  timeline: import("./types").Timeline,
  onProgress?: (ratio: number) => void,
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  const renderer = new GraphiteRenderer(canvas, job, timeline);
  const duration = totalDuration(job, timeline);
  return recordCanvas(
    canvas,
    duration,
    job.width * job.height,
    (t) => {
      renderer.draw(t);
    },
    onProgress,
  );
}

export async function exportCompositionWebM(
  stage: StageSize,
  plates: Plate[],
  onProgress?: (ratio: number) => void,
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  const renderer = new StageRenderer(canvas, stage);
  const duration = compositionDuration(plates);
  return recordCanvas(
    canvas,
    duration,
    stage.width * stage.height,
    (t) => {
      renderer.draw(plates, t, "animation");
    },
    onProgress,
  );
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 4_000);
}
