import { analyzeRaster } from "./analyze";
import type { AnalyzeParams } from "./types";

type Request = {
  id: number;
  width: number;
  height: number;
  buffer: ArrayBuffer;
  params: AnalyzeParams;
};

self.onmessage = (event: MessageEvent<Request>) => {
  const { id, width, height, buffer, params } = event.data;
  try {
    const rgba = new Uint8ClampedArray(buffer);
    const job = analyzeRaster(width, height, rgba, params);
    const transfers: Transferable[] = [
      job.rgba.buffer,
      job.gray.buffer,
      job.lineOrder.buffer,
      job.toneOrder.buffer,
      job.pixelLevel.buffer,
    ];
    for (const layer of job.layers) transfers.push(layer.pixels.buffer);
    (self as unknown as Worker).postMessage({ id, job }, transfers);
  } catch (err) {
    (self as unknown as Worker).postMessage({
      id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
