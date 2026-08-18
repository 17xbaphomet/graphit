import { Muxer, ArrayBufferTarget } from "webm-muxer";
import type { GraphiteJob, Plate, StageSize, Timeline } from "./types";
import { GraphiteRenderer, totalDuration } from "./render";
import { StageRenderer, compositionDuration } from "./compose";

export const EXPORT_FPS = 30;

export function exportFrameCount(durationMs: number): number {
  return Math.max(1, Math.round((durationMs / 1000) * EXPORT_FPS));
}

export function exportDurationMs(durationMs: number): number {
  return (exportFrameCount(durationMs) / EXPORT_FPS) * 1000;
}

function evenSize(n: number) {
  return n + (n & 1);
}

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

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function pickCodec(
  width: number,
  height: number,
  bitrate: number,
): Promise<{ codec: string; mux: "V_VP9" | "V_VP8" } | null> {
  if (typeof VideoEncoder === "undefined" || !VideoEncoder.isConfigSupported) {
    return null;
  }
  const options = [
    { codec: "vp09.00.10.08", mux: "V_VP9" as const },
    { codec: "vp8", mux: "V_VP8" as const },
  ];
  for (const option of options) {
    try {
      const check = await VideoEncoder.isConfigSupported({
        codec: option.codec,
        width,
        height,
        bitrate,
        framerate: EXPORT_FPS,
      });
      if (check.supported) return option;
    } catch {
      /* try next */
    }
  }
  return null;
}

async function encodeTimedWebM(
  canvas: HTMLCanvasElement,
  durationMs: number,
  bitrate: number,
  draw: (t: number) => void,
  onProgress?: (ratio: number) => void,
): Promise<Blob | null> {
  const width = evenSize(canvas.width);
  const height = evenSize(canvas.height);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const picked = await pickCodec(width, height, bitrate);
  if (!picked) return null;

  const frames = exportFrameCount(durationMs);
  const frameUs = 1_000_000 / EXPORT_FPS;
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: {
      codec: picked.mux,
      width,
      height,
      frameRate: EXPORT_FPS,
    },
    firstTimestampBehavior: "offset",
  });

  let failed: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (err) => {
      failed = err instanceof Error ? err : new Error(String(err));
    },
  });
  encoder.configure({
    codec: picked.codec,
    width,
    height,
    bitrate,
    framerate: EXPORT_FPS,
    latencyMode: "quality",
  });

  for (let f = 0; f < frames; f++) {
    if (failed) throw failed;
    const t = frames === 1 ? 0 : (f / (frames - 1)) * durationMs;
    draw(t);
    const videoFrame = new VideoFrame(canvas, {
      timestamp: Math.round(f * frameUs),
      duration: Math.round(frameUs),
    });
    encoder.encode(videoFrame, { keyFrame: f % EXPORT_FPS === 0 });
    videoFrame.close();
    if (encoder.encodeQueueSize > 8) {
      await new Promise<void>((resolve) => {
        const tick = () => {
          if (encoder.encodeQueueSize <= 4) resolve();
          else window.setTimeout(tick, 8);
        };
        tick();
      });
    }
    if (f % 3 === 0) {
      onProgress?.(f / frames);
      await sleep(0);
    }
  }

  await encoder.flush();
  encoder.close();
  if (failed) throw failed;
  muxer.finalize();
  return new Blob([target.buffer], { type: "video/webm" });
}

async function recordPacedWebM(
  canvas: HTMLCanvasElement,
  durationMs: number,
  bitrate: number,
  draw: (t: number) => void,
  onProgress?: (ratio: number) => void,
): Promise<Blob> {
  if (typeof MediaRecorder === "undefined") {
    throw new Error("Videoexport wird von diesem Browser nicht unterstützt");
  }
  const frames = exportFrameCount(durationMs);
  const frameMs = 1000 / EXPORT_FPS;
  const mime = pickMime();
  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0] as MediaStreamTrack & {
    requestFrame?: () => void;
  };
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
  const origin = performance.now();
  for (let f = 0; f < frames; f++) {
    const t = frames === 1 ? 0 : (f / (frames - 1)) * durationMs;
    draw(t);
    track?.requestFrame?.();
    onProgress?.(f / frames);
    const due = origin + (f + 1) * frameMs;
    const wait = due - performance.now();
    if (wait > 0) await sleep(wait);
  }

  if (recorder.state !== "inactive") recorder.stop();
  await stopped;
  stream.getTracks().forEach((tr) => tr.stop());
  if (chunks.length === 0) throw new Error("Die Aufnahme ist leer");
  return new Blob(chunks, { type: mime.split(";")[0] });
}

async function recordCanvas(
  canvas: HTMLCanvasElement,
  durationMs: number,
  pixels: number,
  draw: (t: number) => void,
  onProgress?: (ratio: number) => void,
): Promise<Blob> {
  const bitrate = Math.min(
    48_000_000,
    Math.max(6_000_000, Math.round(pixels * 2.4)),
  );
  const timed = await encodeTimedWebM(
    canvas,
    durationMs,
    bitrate,
    draw,
    onProgress,
  );
  if (timed) return timed;
  return recordPacedWebM(canvas, durationMs, bitrate, draw, onProgress);
}

export async function exportWebM(
  job: GraphiteJob,
  timeline: Timeline,
  onProgress?: (ratio: number) => void,
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  const renderer = new GraphiteRenderer(canvas, job, timeline);
  return recordCanvas(
    canvas,
    totalDuration(job, timeline),
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
  const renderer = new StageRenderer(canvas, {
    width: evenSize(stage.width),
    height: evenSize(stage.height),
  });
  const durationMs = compositionDuration(plates);
  return recordCanvas(
    canvas,
    durationMs,
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
