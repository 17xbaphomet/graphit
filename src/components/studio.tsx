import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Download,
  ImagePlus,
  LoaderCircle,
  Pause,
  PenLine,
  Play,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { AuthSlot } from "@/components/auth-slot";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { analyzeSource } from "@/lib/graphite/analyze";
import { downloadBlob, exportWebM } from "@/lib/graphite/export";
import { GraphiteRenderer, totalDuration } from "@/lib/graphite/render";
import {
  DEFAULT_PARAMS,
  DEFAULT_TIMELINE,
  type AnalyzeParams,
  type GraphiteJob,
  type PhaseInfo,
  type Timeline,
} from "@/lib/graphite/types";
import { cn } from "@/lib/utils";

const SAMPLES = [
  {
    id: "atelier",
    label: "Atelier",
    src: "/samples/atelier.jpg",
  },
  {
    id: "kathedrale",
    label: "Kathedrale",
    src: "/samples/kathedrale.jpg",
  },
  {
    id: "alpen",
    label: "Alpen",
    src: "/samples/alpen.jpg",
  },
] as const;

type ViewMode = "animation" | "lines" | "original";

function formatMs(ms: number) {
  return `${(ms / 1000).toFixed(1)} s`;
}

function formatSize(px: number) {
  if (px >= 3840) return `${px} · 4K UHD`;
  if (px >= 2560) return `${px} · QHD`;
  if (px >= 1920) return `${px} · FHD`;
  if (px >= 1280) return `${px} · HD`;
  return `${px} px`;
}

const SIZE_PRESETS = [
  { label: "HD", size: 1280 },
  { label: "FHD", size: 1920 },
  { label: "QHD", size: 2560 },
  { label: "4K", size: 3840 },
] as const;

export function Studio() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<GraphiteRenderer | null>(null);
  const clockRef = useRef({ playing: false, origin: 0, t: 0 });
  const fileRef = useRef<HTMLInputElement>(null);
  const sourceRef = useRef<File | string>(SAMPLES[0].src);
  const paramsRef = useRef(DEFAULT_PARAMS);
  const timelineRef = useRef(DEFAULT_TIMELINE);

  const [params, setParams] = useState<AnalyzeParams>(DEFAULT_PARAMS);
  const [timeline, setTimeline] = useState<Timeline>(DEFAULT_TIMELINE);
  const [job, setJob] = useState<GraphiteJob | null>(null);
  const [busy, setBusy] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportRatio, setExportRatio] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [tMs, setTMs] = useState(0);
  const [phase, setPhase] = useState<PhaseInfo | null>(null);
  const [view, setView] = useState<ViewMode>("animation");
  const [activeSample, setActiveSample] = useState<string>("atelier");
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState<AnalyzeParams>(DEFAULT_PARAMS);
  const [loop, setLoop] = useState(false);

  paramsRef.current = params;
  timelineRef.current = timeline;

  const duration = job ? totalDuration(job, timeline) : 1;
  const dirty =
    params.maxSize !== applied.maxSize ||
    params.edgeThreshold !== applied.edgeThreshold ||
    params.inkThreshold !== applied.inkThreshold ||
    params.includeInk !== applied.includeInk ||
    params.minStroke !== applied.minStroke ||
    params.levels !== applied.levels;

  const paint = useCallback((ms: number, mode: ViewMode) => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    if (mode === "lines") {
      renderer.drawLinesOnly();
      return;
    }
    if (mode === "original") {
      renderer.drawOriginal();
      return;
    }
    setPhase(renderer.draw(ms));
  }, []);

  const attachJob = useCallback((next: GraphiteJob, nextTimeline: Timeline) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!rendererRef.current) {
      rendererRef.current = new GraphiteRenderer(canvas, next, nextTimeline);
    } else {
      rendererRef.current.attach(next, nextTimeline);
    }
  }, []);

  const runAnalyze = useCallback(
    async (source: File | string, nextParams = paramsRef.current) => {
      sourceRef.current = source;
      setBusy(true);
      setError(null);
      setPlaying(false);
      clockRef.current.playing = false;
      try {
        await new Promise((r) => window.setTimeout(r, 40));
        const next = await analyzeSource(source, nextParams);
        setJob(next);
        setApplied(nextParams);
        attachJob(next, timelineRef.current);
        clockRef.current.t = 0;
        setTMs(0);
        setView("animation");
        paint(0, "animation");
        return true;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Analyse fehlgeschlagen";
        setError(message);
        toast.error(message);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [attachJob, paint],
  );

  useEffect(() => {
    void runAnalyze(SAMPLES[0].src).then((ok) => {
      if (ok) setPlaying(true);
    });
  }, [runAnalyze]);

  useEffect(() => {
    if (!job) return;
    attachJob(job, timeline);
    paint(clockRef.current.t, view);
  }, [attachJob, job, paint, timeline, view]);

  useEffect(() => {
    if (!playing || !job || view !== "animation") return;
    clockRef.current.playing = true;
    clockRef.current.origin = performance.now() - clockRef.current.t;
    let raf = 0;
    let lastUi = 0;
    const tick = (now: number) => {
      if (!clockRef.current.playing) return;
      const t = now - clockRef.current.origin;
      const cap = totalDuration(job, timeline);
      if (t >= cap) {
        if (loop) {
          clockRef.current.origin = now;
          clockRef.current.t = 0;
          paint(0, "animation");
          raf = requestAnimationFrame(tick);
          return;
        }
        clockRef.current.t = cap;
        clockRef.current.playing = false;
        setTMs(cap);
        setPlaying(false);
        paint(cap, "animation");
        return;
      }
      clockRef.current.t = t;
      paint(t, "animation");
      if (now - lastUi > 80) {
        lastUi = now;
        setTMs(t);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      clockRef.current.playing = false;
      cancelAnimationFrame(raf);
    };
  }, [job, loop, paint, playing, timeline, view]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "BUTTON") return;
      e.preventDefault();
      if (!job || busy || exporting) return;
      setView("animation");
      if (clockRef.current.t >= totalDuration(job, timeline) - 16) {
        clockRef.current.t = 0;
        setTMs(0);
      }
      setPlaying((p) => !p);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, exporting, job, timeline]);

  const seek = (ms: number) => {
    const next = Math.max(0, Math.min(duration, ms));
    clockRef.current.t = next;
    clockRef.current.origin = performance.now() - next;
    setTMs(next);
    setView("animation");
    paint(next, "animation");
  };

  const replay = () => {
    seek(0);
    setPlaying(true);
  };

  const loadSample = (src: string, id: string) => {
    setActiveSample(id);
    void runAnalyze(src).then((ok) => {
      if (ok) setPlaying(true);
    });
  };

  const onFile = (file: File | undefined) => {
    if (!file) return;
    setActiveSample("");
    void runAnalyze(file).then((ok) => {
      if (ok) setPlaying(true);
    });
  };

  const applyParams = (patch: Partial<AnalyzeParams>) => {
    setParams((prev) => ({ ...prev, ...patch }));
  };

  const reprocess = () => {
    void runAnalyze(sourceRef.current, params).then((ok) => {
      if (ok) setPlaying(true);
    });
  };

  const onExport = async () => {
    if (!job) return;
    setExporting(true);
    setExportRatio(0);
    setPlaying(false);
    try {
      const blob = await exportWebM(job, timeline, setExportRatio);
      downloadBlob(blob, `graphit-${Date.now()}.webm`);
      toast.success("Video gespeichert");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export fehlgeschlagen");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 md:gap-8 md:px-8 md:py-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-xl">
          <p className="text-xs font-medium uppercase tracking-caps text-subtle">
            Zeichenanimation
          </p>
          <h1 className="mt-1 font-display text-4xl leading-none tracking-display text-fg md:text-5xl">
            Graphit
          </h1>
          <p className="mt-3 max-w-md text-pretty text-sm leading-normal text-muted">
            Zuerst die schwarzen Linien, als würde eine Hand sie ziehen. Dann
            die Tonwerte — dunkel zuerst — mit derselben Zeichenhand, Fläche
            für Fläche.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <AuthSlot />
          <Button
            type="button"
            variant="outline"
            onClick={() => fileRef.current?.click()}
          >
            <ImagePlus />
            Bild laden
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
        </div>
      </header>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="rounded-xl bg-surface p-2 shadow-border">
          <div className="relative overflow-hidden rounded-lg bg-paper">
            <canvas
              ref={canvasRef}
              className="mx-auto block h-auto max-h-stage w-full bg-paper object-contain"
              aria-label="Zeichenvorschau"
            />
            {(busy || exporting) && (
              <div className="absolute inset-0 grid place-items-center bg-paper/70 text-ink">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <LoaderCircle className="size-4 animate-spin" />
                  {exporting
                    ? `Export ${Math.round(exportRatio * 100)}%`
                    : "Bild wird gelesen"}
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-3 px-2 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  if (!job) return;
                  setView("animation");
                  if (clockRef.current.t >= duration - 16) seek(0);
                  setPlaying((p) => !p);
                }}
                disabled={!job || busy || exporting}
              >
                {playing ? <Pause /> : <Play />}
                {playing ? "Pause" : "Abspielen"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={replay}
                disabled={!job || busy || exporting}
              >
                <RotateCcw />
                Nochmal
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void onExport()}
                disabled={!job || busy || exporting}
              >
                <Download />
                WebM
              </Button>
              <div className="ml-auto flex rounded-md bg-raised p-0.5">
                {(
                  [
                    ["animation", "Lauf"],
                    ["lines", "Linien"],
                    ["original", "Bild"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      setPlaying(false);
                      setView(id);
                    }}
                    className={cn(
                      "h-8 rounded-sm px-2.5 text-xs font-medium transition-colors duration-150",
                      view === id
                        ? "bg-surface text-fg"
                        : "text-muted hover:text-fg",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <span className="w-10 shrink-0 text-xs tabular-nums text-subtle">
                {formatMs(tMs)}
              </span>
              <Slider
                min={0}
                max={duration}
                step={16}
                value={[tMs]}
                onValueChange={(v) => {
                  setPlaying(false);
                  seek(v[0] ?? 0);
                }}
                disabled={!job || busy || exporting}
              />
              <span className="w-10 shrink-0 text-right text-xs tabular-nums text-subtle">
                {formatMs(duration)}
              </span>
            </div>

            <div className="flex items-center justify-between gap-3 text-xs text-muted">
              <span className="inline-flex items-center gap-1.5">
                <PenLine className="size-3.5" />
                {phase?.label ?? "Bereit"}
              </span>
              {job && (
                <span className="tabular-nums text-subtle">
                  {job.width}×{job.height} ·{" "}
                  {job.lineOrder.length.toLocaleString("de-DE")} Linien ·{" "}
                  {job.layers.length} Töne
                </span>
              )}
            </div>
            {error && <p className="text-xs text-danger">{error}</p>}
          </div>
        </section>

        <aside className="flex flex-col gap-5 rounded-xl bg-surface p-4 shadow-border md:p-5">
          <div>
            <Label>Vorlagen</Label>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {SAMPLES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => loadSample(s.src, s.id)}
                  className={cn(
                    "overflow-hidden rounded-md text-left shadow-border transition-[box-shadow,transform] duration-150 active:scale-[0.96]",
                    activeSample === s.id && "ring-1 ring-fg/40",
                  )}
                >
                  <img
                    src={s.src}
                    alt={s.label}
                    className="aspect-still w-full object-cover"
                  />
                  <span className="block px-2 py-1.5 text-xs font-medium text-fg">
                    {s.label}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <Separator />

          <fieldset className="flex flex-col gap-4">
            <legend className="text-xs font-medium tracking-wide text-muted">
              Bild
            </legend>
            <Field
              label="Auflösung"
              value={formatSize(params.maxSize)}
            >
              <Slider
                min={360}
                max={3840}
                step={40}
                value={[params.maxSize]}
                onValueChange={(v) =>
                  applyParams({ maxSize: v[0] ?? 680 })
                }
              />
            </Field>
            <div className="flex flex-wrap gap-1.5">
              {SIZE_PRESETS.map((p) => (
                <button
                  key={p.size}
                  type="button"
                  onClick={() => applyParams({ maxSize: p.size })}
                  className={cn(
                    "h-8 rounded-md px-2.5 text-xs font-medium shadow-border transition-colors",
                    params.maxSize === p.size
                      ? "bg-fg text-bg"
                      : "bg-raised text-muted hover:text-fg",
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <p className="text-xs leading-normal text-subtle">
              Längste Seite, bis 3840 px (4K UHD). Höher wird schärfer, die
              Erkennung und der Export dauern länger.
              {job ? ` Aktuell ${job.width}×${job.height}.` : ""}
            </p>
          </fieldset>

          <Separator />

          <fieldset className="flex flex-col gap-4">
            <legend className="text-xs font-medium tracking-wide text-muted">
              Ablauf
            </legend>
            <Field label="Liniendauer" value={formatMs(timeline.lineMs)}>
              <Slider
                min={1200}
                max={9000}
                step={100}
                value={[timeline.lineMs]}
                onValueChange={(v) =>
                  setTimeline((t) => ({ ...t, lineMs: v[0] ?? t.lineMs }))
                }
              />
            </Field>
            <Field label="Töne" value={formatMs(timeline.toneMs)}>
              <Slider
                min={2400}
                max={14000}
                step={100}
                value={[timeline.toneMs]}
                onValueChange={(v) =>
                  setTimeline((t) => ({ ...t, toneMs: v[0] ?? t.toneMs }))
                }
              />
            </Field>
            <Field label="Halten" value={formatMs(timeline.holdMs)}>
              <Slider
                min={400}
                max={5000}
                step={100}
                value={[timeline.holdMs]}
                onValueChange={(v) =>
                  setTimeline((t) => ({ ...t, holdMs: v[0] ?? t.holdMs }))
                }
              />
            </Field>
            <label className="flex min-h-11 items-center gap-3 text-sm text-fg">
              <input
                type="checkbox"
                checked={loop}
                onChange={(e) => setLoop(e.target.checked)}
                className="size-4 accent-fg"
              />
              In Schleife abspielen
            </label>
          </fieldset>

          <Separator />

          <fieldset className="flex flex-col gap-4">
            <legend className="text-xs font-medium tracking-wide text-muted">
              Erkennung
            </legend>
            <Field label="Tonstufen" value={String(params.levels)}>
              <Slider
                min={4}
                max={16}
                step={1}
                value={[params.levels]}
                onValueChange={(v) => applyParams({ levels: v[0] ?? 10 })}
              />
            </Field>
            <Field label="Kanten" value={`${params.edgeThreshold}`}>
              <Slider
                min={8}
                max={48}
                step={1}
                value={[params.edgeThreshold]}
                onValueChange={(v) =>
                  applyParams({ edgeThreshold: v[0] ?? 20 })
                }
              />
            </Field>
            <Field label="Tusche" value={`${params.inkThreshold}`}>
              <Slider
                min={8}
                max={90}
                step={1}
                value={[params.inkThreshold]}
                onValueChange={(v) =>
                  applyParams({ inkThreshold: v[0] ?? 44 })
                }
              />
            </Field>
            <Field label="Feinstriche" value={`${params.minStroke} px`}>
              <Slider
                min={1}
                max={14}
                step={1}
                value={[params.minStroke]}
                onValueChange={(v) =>
                  applyParams({ minStroke: v[0] ?? 3 })
                }
              />
            </Field>
            <p className="text-xs leading-normal text-subtle">
              Kürzere Linien fallen weg. Niedriger = mehr Details, höher =
              nur die großen Züge.
            </p>
            <label className="flex min-h-11 items-center gap-3 text-sm text-fg">
              <input
                type="checkbox"
                checked={params.includeInk}
                onChange={(e) => applyParams({ includeInk: e.target.checked })}
                className="size-4 accent-fg"
              />
              Dunkle Konturen mitzeichnen
            </label>
            <div className="flex flex-col gap-2">
              <Button
                type="button"
                variant={dirty ? "default" : "secondary"}
                onClick={reprocess}
                disabled={busy || !dirty}
              >
                Änderungen anwenden
              </Button>
              <button
                type="button"
                onClick={() => {
                  setParams(DEFAULT_PARAMS);
                  setTimeline(DEFAULT_TIMELINE);
                  setLoop(false);
                }}
                className="min-h-11 text-xs text-muted transition-colors hover:text-fg"
              >
                Standardwerte
              </button>
            </div>
          </fieldset>
        </aside>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <Label>{label}</Label>
        <span className="text-xs tabular-nums text-subtle">{value}</span>
      </div>
      {children}
    </div>
  );
}
