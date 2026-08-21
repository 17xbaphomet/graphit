import { analyzeRaster } from "./analyze";
import type { AnalyzeParams, GraphiteJob } from "./types";

export function hardwareLimit(): number {
  const cores =
    typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 4 : 2;
  return Math.max(1, Math.min(8, cores));
}

export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const out = new Array<R>(items.length);
  let next = 0;
  const run = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i] as T, i);
    }
  };
  const n = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: n }, () => run()));
  return out;
}

type Pending = {
  resolve: (job: GraphiteJob) => void;
  reject: (err: Error) => void;
};

type WorkerResponse = {
  id: number;
  job?: GraphiteJob;
  error?: string;
};

let workers: Worker[] = [];
let idle: Worker[] = [];
const waiting: Array<() => void> = [];
const pending = new Map<number, Pending>();
let seq = 1;
let poolFailed = false;

function spawn(): Worker {
  const worker = new Worker(new URL("./analyze.worker.ts", import.meta.url), {
    type: "module",
  });
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const { id, job, error } = event.data;
    const slot = pending.get(id);
    if (!slot) return;
    pending.delete(id);
    idle.push(worker);
    const wake = waiting.shift();
    if (wake) wake();
    if (error || !job) slot.reject(new Error(error ?? "Analyse fehlgeschlagen"));
    else slot.resolve(job);
  };
  worker.onerror = () => {
    poolFailed = true;
    worker.terminate();
    workers = workers.filter((w) => w !== worker);
    idle = idle.filter((w) => w !== worker);
  };
  workers.push(worker);
  idle.push(worker);
  return worker;
}

function ensurePool() {
  if (poolFailed || typeof Worker === "undefined") return;
  const want = hardwareLimit();
  while (workers.length < want) spawn();
}

function takeWorker(): Promise<Worker> {
  ensurePool();
  const ready = idle.pop();
  if (ready) return Promise.resolve(ready);
  return new Promise((resolve) => {
    waiting.push(() => {
      const w = idle.pop();
      if (w) resolve(w);
    });
  });
}

export async function analyzeRasterOffthread(
  width: number,
  height: number,
  data: Uint8ClampedArray,
  params: AnalyzeParams,
): Promise<GraphiteJob> {
  if (poolFailed || typeof Worker === "undefined") {
    return analyzeRaster(width, height, data, params);
  }
  try {
    ensurePool();
    const worker = await takeWorker();
    const id = seq++;
    const buffer = data.buffer.slice(
      data.byteOffset,
      data.byteOffset + data.byteLength,
    );
    const job = await new Promise<GraphiteJob>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, width, height, buffer, params }, [buffer]);
    });
    return job;
  } catch {
    poolFailed = true;
    return analyzeRaster(width, height, data, params);
  }
}
