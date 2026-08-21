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
): Promise<{
  mux: "V_VP9" | "V_VP8";
  config: VideoEncoderConfig;
} | null> {
  if (typeof VideoEncoder === "undefined" || !VideoEncoder.isConfigSupported) {
    return null;
  }
  const luma = width * height;
  const vp9 =
    luma > 8_000_000
      ? ["vp09.00.51.08", "vp09.00.50.08"]
      : luma > 2_200_000
        ? ["vp09.00.50.08", "vp09.00.41.08", "vp09.00.40.08"]
        : ["vp09.00.40.08", "vp09.00.31.08"];
  const codecs: { codec: string; mux: "V_VP9" | "V_VP8" }[] = [
    ...vp9.map((codec) => ({ codec, mux: "V_VP9" as const })),
    { codec: "vp8", mux: "V_VP8" },
  ];
  const hwModes: Array<VideoEncoderConfig["hardwareAcceleration"] | undefined> =
    luma >= 2560 * 1440
      ? [undefined, "prefer-software"]
      : ["prefer-hardware", undefined, "prefer-software"];
  const latency: VideoEncoderConfig["latencyMode"] =
    luma >= 2560 * 1440 ? "realtime" : "quality";

  for (const option of codecs) {
    for (const hw of hwModes) {
      const config: VideoEncoderConfig = {
        codec: option.codec,
        width,
        height,
        bitrate,
        framerate: EXPORT_FPS,
        latencyMode: latency,
      };
      if (hw) config.hardwareAcceleration = hw;
      try {
        const check = await VideoEncoder.isConfigSupported(config);
        if (check.supported) {
          return {
            mux: option.mux,
            config: (check.config as VideoEncoderConfig | undefined) ?? config,
          };
        }
      } catch {
        /* try next */
      }
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

  const luma = width * height;
  const maxQueue = luma >= 2560 * 1440 ? 4 : 12;
  const drainTo = Math.max(1, Math.floor(maxQueue / 2));

  let failed: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (err) => {
      failed = err instanceof Error ? err : new Error(String(err));
    },
  });

  try {
    encoder.configure(picked.config);

    for (let f = 0; f < frames; f++) {
      if (failed) throw failed;
      const t = frames === 1 ? 0 : (f / (frames - 1)) * durationMs;
      draw(t);
      const videoFrame = new VideoFrame(canvas, {
        timestamp: Math.round(f * frameUs),
        duration: Math.round(frameUs),
      });
      try {
        encoder.encode(videoFrame, { keyFrame: f % EXPORT_FPS === 0 });
      } finally {
        videoFrame.close();
      }
      if (encoder.encodeQueueSize > maxQueue) {
        await new Promise<void>((resolve) => {
          const tick = () => {
            if (failed || encoder.encodeQueueSize <= drainTo) resolve();
            else window.setTimeout(tick, 8);
          };
          tick();
        });
      }
      if (f % 8 === 0) {
        onProgress?.(f / frames);
        await sleep(0);
      }
    }

    await encoder.flush();
    if (failed) throw failed;
    muxer.finalize();
    return new Blob([target.buffer], { type: "video/webm" });
  } catch {
    return null;
  } finally {
    try {
      if (encoder.state !== "closed") encoder.close();
    } catch {
      /* already closed */
    }
  }
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
    lumaCap(pixels),
    Math.max(6_000_000, Math.round(pixels * 1.8)),
  );
  try {
    const timed = await encodeTimedWebM(
      canvas,
      durationMs,
      bitrate,
      draw,
      onProgress,
    );
    if (timed) return timed;
  } catch {
    /* MediaRecorder fallback */
  }
  return recordPacedWebM(canvas, durationMs, bitrate, draw, onProgress);
}

function lumaCap(pixels: number) {
  if (pixels >= 3840 * 2160) return 28_000_000;
  if (pixels >= 2560 * 1440) return 22_000_000;
  return 48_000_000;
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

function isTopWindow(): boolean {
  try {
    return window.self === window.top;
  } catch {
    return false;
  }
}

export function canUseFolderPicker(): boolean {
  return isTopWindow() && "showDirectoryPicker" in window;
}

export function canUseSavePicker(): boolean {
  return isTopWindow() && "showSaveFilePicker" in window;
}

export function objectUrlFor(blob: Blob): string {
  return URL.createObjectURL(blob);
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.target = "_blank";
  a.type = blob.type || "video/webm";
  document.body.appendChild(a);
  a.click();
  window.setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 8_000);
}

export async function saveBlob(blob: Blob, filename: string): Promise<boolean> {
  const w = window as Window & {
    showSaveFilePicker?: (opts: {
      suggestedName?: string;
      types?: Array<{ description: string; accept: Record<string, string[]> }>;
    }) => Promise<FileSystemFileHandle>;
  };
  if (isTopWindow() && w.showSaveFilePicker) {
    try {
      const handle = await w.showSaveFilePicker({
        suggestedName: filename,
        types: [
          {
            description: "WebM-Video",
            accept: { "video/webm": [".webm"] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return true;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return false;
    }
  }
  downloadBlob(blob, filename);
  return true;
}

export async function pickExportDirectory(): Promise<FileSystemDirectoryHandle | null> {
  if (!canUseFolderPicker()) return null;
  const picker = (
    window as Window & {
      showDirectoryPicker?: (opts?: {
        id?: string;
        mode?: "read" | "readwrite";
      }) => Promise<FileSystemDirectoryHandle>;
    }
  ).showDirectoryPicker;
  if (!picker) return null;
  try {
    return await picker({ id: "graphit-exports", mode: "readwrite" });
  } catch {
    return null;
  }
}

export async function writeBlobToDirectory(
  dir: FileSystemDirectoryHandle,
  filename: string,
  blob: Blob,
): Promise<void> {
  const handle = await dir.getFileHandle(filename, { create: true });
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
}
