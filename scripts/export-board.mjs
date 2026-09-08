#!/usr/bin/env node
/** Headless Graphit Studio export: graphit.json + stills → webm via Playwright. */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, extname, join } from "node:path";
import { chromium } from "playwright";

function arg(name, fallback = "") {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] || fallback : fallback;
}

function mime(path) {
  const ext = extname(path).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "image/png";
}

function dataUrl(path) {
  const buf = readFileSync(path);
  return `data:${mime(path)};base64,${buf.toString("base64")}`;
}

function resolveStill(name, kind, spec, cfg, jobsByName, stillsDir) {
  const candidates = [];
  if (spec.file) candidates.push(spec.file);
  const idx = spec.image;
  if (typeof idx === "number" && cfg.images && cfg.images[idx]) {
    candidates.push(cfg.images[idx]);
  }
  const job = jobsByName.get(name) || {};
  if (job.file) candidates.push(job.file);
  for (const key of ["flux_files", "files"]) {
    const files = job[key] || [];
    if (files.length) candidates.push(key === "flux_files" ? files[files.length - 1] : files[0]);
  }
  if (stillsDir && name) {
    candidates.push(join(stillsDir, `${name}.png`));
    try {
      const hits = readdirSync(stillsDir)
        .filter((f) => f.startsWith(`stack-${name}`) && f.endsWith(".png") && !f.includes("-ref-"))
        .sort();
      if (hits.length) candidates.push(join(stillsDir, hits[hits.length - 1]));
    } catch {
      /* no stills dir */
    }
  }
  if (kind === "map" && name) {
    candidates.push(`/tmp/${name}.png`);
  }
  for (const c of candidates) {
    if (c && existsSync(c) && !String(c).includes("-ref-")) return c;
  }
  return null;
}

const configPath = resolve(arg("--config"));
const outPath = resolve(arg("--out"));
const url = arg("--url", process.env.GRAPHIT_URL || "http://127.0.0.1:8090");
const jobsPath = arg("--jobs", process.env.GRAPHIT_JOBS || "/workspace/output/stack-run/jobs.json");
const stillsDir = arg("--stills", process.env.GRAPHIT_STILLS || "/workspace/output/stack-run/stills");
if (!configPath || !outPath || !existsSync(configPath)) {
  console.error("usage: node export-board.mjs --config board.json --out clip.webm [--url http://127.0.0.1:8090] [--jobs jobs.json] [--stills dir]");
  process.exit(2);
}

const cfg = JSON.parse(readFileSync(configPath, "utf8"));
const jobsByName = new Map();
if (existsSync(jobsPath)) {
  for (const j of JSON.parse(readFileSync(jobsPath, "utf8"))) {
    if (j?.name) jobsByName.set(j.name, j);
  }
}

const plates = [];
for (const spec of cfg.plates || []) {
  if ((spec.kind || "image") === "text") continue;
  const name = spec.name || "plate";
  const file = resolveStill(name, spec.kind || "", spec, cfg, jobsByName, stillsDir);
  if (!file) {
    console.error("missing still", name);
    continue;
  }
  console.error("still", name, "←", file);
  plates.push({
    name,
    dataUrl: dataUrl(file),
    frame: spec.frame || { x: 0.04, y: 0.04, w: 0.92, h: 0.92 },
    startMs: spec.startMs || 0,
    lineMs: spec.lineMs ?? cfg.master?.lineMs ?? 4000,
    toneMs: spec.toneMs ?? cfg.master?.toneMs ?? 1500,
    holdMs: spec.holdMs ?? cfg.master?.holdMs ?? 1000,
    maxSize: spec.maxSize ?? cfg.master?.maxSize ?? 680,
    transparency: spec.transparency ?? cfg.master?.transparency ?? 100,
  });
}
if (!plates.length) {
  console.error("no plates");
  process.exit(1);
}

const browser = await chromium.launch({
  headless: true,
  args: [
    "--ignore-gpu-blocklist",
    "--use-gl=angle",
    "--use-angle=gl",
    "--enable-webgl",
    "--disable-software-rasterizer",
  ],
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto(`${url.replace(/\/$/, "")}/headless`, { waitUntil: "networkidle", timeout: 60_000 });
await page.waitForFunction(() => window.__graphitReady === true, { timeout: 30_000 });
const dataUrlOut = await page.evaluate(async (spec) => {
  if (typeof window.__graphitExport !== "function") {
    throw new Error("__graphitExport missing — is /headless built?");
  }
  return window.__graphitExport(spec);
}, {
  stage: cfg.stage || { width: 1920, height: 1080 },
  plates,
});
await browser.close();
if (!dataUrlOut || !dataUrlOut.startsWith("data:")) {
  console.error("empty export");
  process.exit(1);
}
const b64 = dataUrlOut.slice(dataUrlOut.indexOf(",") + 1);
writeFileSync(outPath, Buffer.from(b64, "base64"));
console.log("wrote", outPath, plates.length, "plates");
