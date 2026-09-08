#!/usr/bin/env node
/** Headless Graphit Studio export: graphit.json + stills → webm via Playwright. */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, extname } from "node:path";
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

const configPath = resolve(arg("--config"));
const outPath = resolve(arg("--out"));
const url = arg("--url", process.env.GRAPHIT_URL || "http://127.0.0.1:8090");
if (!configPath || !outPath || !existsSync(configPath)) {
  console.error("usage: node export-board.mjs --config board.json --out clip.webm [--url http://127.0.0.1:8090]");
  process.exit(2);
}

const cfg = JSON.parse(readFileSync(configPath, "utf8"));
const images = cfg.images || [];
const plates = [];
for (const spec of cfg.plates || []) {
  if ((spec.kind || "image") === "text") continue;
  const idx = spec.image;
  const file = spec.file || (typeof idx === "number" ? images[idx] : null);
  if (!file || !existsSync(file)) {
    console.error("missing still", spec.name, file);
    continue;
  }
  plates.push({
    name: spec.name || "plate",
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
