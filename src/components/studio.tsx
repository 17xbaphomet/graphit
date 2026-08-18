import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ChevronDown,
  ChevronUp,
  Download,
  ImagePlus,
  LoaderCircle,
  Pause,
  PenLine,
  Play,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { AuthSlot } from "@/components/auth-slot";
import { FrameOverlay } from "@/components/frame-overlay";
import { TimelineTrack } from "@/components/timeline-track";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { analyzeSource } from "@/lib/graphite/analyze";
import {
  StageRenderer,
  compositionDuration,
  nextStartMs,
  suggestFrame,
} from "@/lib/graphite/compose";
import { downloadBlob, exportCompositionWebM } from "@/lib/graphite/export";
import {
  DEFAULT_PARAMS,
  DEFAULT_STAGE,
  DEFAULT_TIMELINE,
  STAGE_PRESETS,
  type AnalyzeParams,
  type FrameRect,
  type PhaseInfo,
  type Plate,
  type StageSize,
  type Timeline,
} from "@/lib/graphite/types";
import { cn } from "@/lib/utils";

const SAMPLES = [
  { id: "atelier", label: "Atelier", src: "/samples/atelier.jpg" },
  { id: "kathedrale", label: "Kathedrale", src: "/samples/kathedrale.jpg" },
  { id: "alpen", label: "Alpen", src: "/samples/alpen.jpg" },
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

function newId() {
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function sourceName(source: File | string, fallback: string) {
  if (typeof source !== "string") return source.name.replace(/\.[^.]+$/, "");
  const sample = SAMPLES.find((s) => s.src === source);
  return sample?.label ?? fallback;
}

function makePlate(
  source: File | string,
  existing: Plate[],
  extras?: Partial<Plate>,
): Plate {
  const thumb = typeof source === "string" ? source : URL.createObjectURL(source);
  return {
    id: newId(),
    name: sourceName(source, `Bild ${existing.length + 1}`),
    source,
    thumb,
    frame: suggestFrame(existing.map((p) => p.frame)),
    startMs: nextStartMs(existing),
    params: { ...DEFAULT_PARAMS },
    timeline: { ...DEFAULT_TIMELINE },
    applied: { ...DEFAULT_PARAMS },
    job: null,
    transparency: 100,
    ...extras,
  };
}

export function Studio() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<StageRenderer | null>(null);
  const clockRef = useRef({ playing: false, origin: 0, t: 0 });
  const fileRef = useRef<HTMLInputElement>(null);
  const platesRef = useRef<Plate[]>([]);
  const genRef = useRef(0);

  const [plates, setPlates] = useState<Plate[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [stage, setStage] = useState<StageSize>(DEFAULT_STAGE);
  const [busy, setBusy] = useState(true);
  const [busyLabel, setBusyLabel] = useState("Bild wird gelesen");
  const [exporting, setExporting] = useState(false);
  const [exportRatio, setExportRatio] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [tMs, setTMs] = useState(0);
  const [phase, setPhase] = useState<PhaseInfo | null>(null);
  const [view, setView] = useState<ViewMode>("animation");
  const [error, setError] = useState<string | null>(null);
  const [loop, setLoop] = useState(false);

  platesRef.current = plates;
  const selected = plates.find((p) => p.id === selectedId) ?? plates[0] ?? null;
  const duration = compositionDuration(plates);
  const ready = plates.some((p) => p.job);
  const dirty = selected
    ? selected.params.maxSize !== selected.applied.maxSize ||
      selected.params.edgeThreshold !== selected.applied.edgeThreshold ||
      selected.params.inkThreshold !== selected.applied.inkThreshold ||
      selected.params.includeInk !== selected.applied.includeInk ||
      selected.params.minStroke !== selected.applied.minStroke ||
      selected.params.levels !== selected.applied.levels
    : false;

  const paint = useCallback((ms: number, mode: ViewMode, list = platesRef.current) => {
    const renderer = stageRef.current;
    if (!renderer) return;
    setPhase(renderer.draw(list, ms, mode));
  }, []);

  const ensureStage = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!stageRef.current) {
      stageRef.current = new StageRenderer(canvas, stage);
    } else {
      stageRef.current.resize(stage);
    }
  }, [stage]);

  const analyzePlate = useCallback(async (plate: Plate) => {
    const job = await analyzeSource(plate.source, plate.params);
    return {
      ...plate,
      job,
      applied: { ...plate.params },
    } satisfies Plate;
  }, []);

  const addSources = useCallback(
    async (sources: { source: File | string; name?: string }[]) => {
      if (sources.length === 0) return;
      const gen = ++genRef.current;
      setBusy(true);
      setError(null);
      setPlaying(false);
      clockRef.current.playing = false;
      const created: Plate[] = [];
      try {
        await new Promise((r) => window.setTimeout(r, 30));
        let working = [...platesRef.current];
        for (let i = 0; i < sources.length; i++) {
          setBusyLabel(
            sources.length > 1
              ? `Bild ${i + 1}/${sources.length} wird gelesen`
              : "Bild wird gelesen",
          );
          const plate = makePlate(sources[i]!.source, working, {
            name: sources[i]!.name ?? sourceName(sources[i]!.source, `Bild ${working.length + 1}`),
          });
          const done = await analyzePlate(plate);
          if (gen !== genRef.current) {
            if (done.thumb.startsWith("blob:")) URL.revokeObjectURL(done.thumb);
            return false;
          }
          working = [...working, done];
          created.push(done);
        }
        if (gen !== genRef.current) return false;
        platesRef.current = working;
        setPlates(working);
        setSelectedId(created[created.length - 1]!.id);
        ensureStage();
        clockRef.current.t = 0;
        setTMs(0);
        setView("animation");
        paint(0, "animation", working);
        return true;
      } catch (err) {
        created.forEach((p) => {
          if (p.thumb.startsWith("blob:")) URL.revokeObjectURL(p.thumb);
        });
        const message =
          err instanceof Error ? err.message : "Analyse fehlgeschlagen";
        setError(message);
        toast.error(message);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [analyzePlate, ensureStage, paint],
  );

  useEffect(() => {
    void addSources([{ source: SAMPLES[0].src, name: SAMPLES[0].label }]).then(
      (ok) => {
        if (ok) setPlaying(true);
      },
    );
    // initial load only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    ensureStage();
    paint(clockRef.current.t, view);
  }, [ensureStage, paint, plates, stage, view]);

  useEffect(() => {
    if (!playing || !ready || view !== "animation") return;
    clockRef.current.playing = true;
    clockRef.current.origin = performance.now() - clockRef.current.t;
    let raf = 0;
    let lastUi = 0;
    const tick = (now: number) => {
      if (!clockRef.current.playing) return;
      const t = now - clockRef.current.origin;
      const cap = compositionDuration(platesRef.current);
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
  }, [loop, paint, playing, ready, view]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "BUTTON") return;
      e.preventDefault();
      if (!ready || busy || exporting) return;
      setView("animation");
      if (clockRef.current.t >= compositionDuration(platesRef.current) - 16) {
        clockRef.current.t = 0;
        setTMs(0);
      }
      setPlaying((p) => !p);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, exporting, ready]);

  const seek = (ms: number) => {
    const next = Math.max(0, Math.min(duration, ms));
    clockRef.current.t = next;
    clockRef.current.origin = performance.now() - next;
    setTMs(next);
    setView("animation");
    paint(next, "animation");
  };

  const updatePlate = (id: string, patch: Partial<Plate>) => {
    setPlates((list) =>
      list.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    );
  };

  const reprocessSelected = async () => {
    if (!selected) return;
    setBusy(true);
    setBusyLabel("Bild wird gelesen");
    setPlaying(false);
    try {
      const next = await analyzePlate(selected);
      setPlates((list) => list.map((p) => (p.id === selected.id ? next : p)));
      paint(clockRef.current.t, view);
      setPlaying(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Analyse fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  };

  const removePlate = (id: string) => {
    setPlates((list) => {
      const gone = list.find((p) => p.id === id);
      if (gone?.thumb.startsWith("blob:")) URL.revokeObjectURL(gone.thumb);
      stageRef.current?.dropPlate(id);
      const next = list.filter((p) => p.id !== id);
      if (selectedId === id) setSelectedId(next[0]?.id ?? null);
      return next;
    });
  };

  const movePlate = (id: string, dir: -1 | 1) => {
    setPlates((list) => {
      const i = list.findIndex((p) => p.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= list.length) return list;
      const copy = [...list];
      const [item] = copy.splice(i, 1);
      copy.splice(j, 0, item!);
      return copy;
    });
  };

  const onExport = async () => {
    if (!ready) return;
    setExporting(true);
    setExportRatio(0);
    setPlaying(false);
    try {
      const blob = await exportCompositionWebM(stage, plates, setExportRatio);
      downloadBlob(blob, `graphit-${Date.now()}.webm`);
      toast.success("Video gespeichert");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export fehlgeschlagen");
    } finally {
      setExporting(false);
    }
  };

  const onFiles = (list: FileList | null) => {
    if (!list?.length) return;
    void addSources([...list].map((file) => ({ source: file })));
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
            Mehrere Bilder auf einer Fläche. Rahmen ziehen und skalieren, Start
            und alle Zeichenparameter je Bild.
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
            Bilder laden
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            onChange={(e) => onFiles(e.target.files)}
          />
        </div>
      </header>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="rounded-xl bg-surface p-2 shadow-border">
          <div
            ref={wrapRef}
            className="relative overflow-hidden rounded-lg bg-paper"
          >
            <canvas
              ref={canvasRef}
              className="mx-auto block h-auto max-h-stage w-full bg-paper"
              aria-label="Zeichenfläche"
            />
            <FrameOverlay
              wrapRef={wrapRef}
              canvasRef={canvasRef}
              plates={plates}
              selectedId={selected?.id ?? null}
              onSelect={(id) => {
                setPlaying(false);
                setSelectedId(id);
              }}
              onChangeFrame={(id, frame: FrameRect) => {
                setPlaying(false);
                updatePlate(id, { frame });
              }}
            />
            {(busy || exporting) && (
              <div className="absolute inset-0 z-20 grid place-items-center bg-paper/70 text-ink">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <LoaderCircle className="size-4 animate-spin" />
                  {exporting
                    ? `Export ${Math.round(exportRatio * 100)}%`
                    : busyLabel}
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
                  if (!ready) return;
                  setView("animation");
                  if (clockRef.current.t >= duration - 16) seek(0);
                  setPlaying((p) => !p);
                }}
                disabled={!ready || busy || exporting}
              >
                {playing ? <Pause /> : <Play />}
                {playing ? "Pause" : "Abspielen"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => {
                  seek(0);
                  setPlaying(true);
                }}
                disabled={!ready || busy || exporting}
              >
                <RotateCcw />
                Nochmal
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void onExport()}
                disabled={!ready || busy || exporting}
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
                disabled={!ready || busy || exporting}
              />
              <span className="w-10 shrink-0 text-right text-xs tabular-nums text-subtle">
                {formatMs(duration)}
              </span>
            </div>

            {plates.length > 0 && (
              <TimelineTrack
                plates={plates}
                selectedId={selected?.id ?? null}
                tMs={tMs}
                duration={duration}
                disabled={busy || exporting}
                onSelect={setSelectedId}
                onSeek={(ms) => {
                  setPlaying(false);
                  seek(ms);
                }}
                onMoveStart={(id, startMs) => {
                  setPlaying(false);
                  updatePlate(id, { startMs });
                }}
              />
            )}

            <div className="flex items-center justify-between gap-3 text-xs text-muted">
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <PenLine className="size-3.5 shrink-0" />
                <span className="truncate">{phase?.label ?? "Bereit"}</span>
              </span>
              <span className="shrink-0 tabular-nums text-subtle">
                {stage.width}×{stage.height}
                {selected?.job
                  ? ` · ${selected.job.width}×${selected.job.height}`
                  : ""}
              </span>
            </div>
            {error && <p className="text-xs text-danger">{error}</p>}
          </div>
        </section>

        <aside className="flex flex-col gap-5 rounded-xl bg-surface p-4 shadow-border md:p-5">
          <div>
            <Label>Fläche</Label>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {STAGE_PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => setStage({ width: p.width, height: p.height })}
                  className={cn(
                    "h-8 rounded-md px-2.5 text-xs font-medium shadow-border transition-colors",
                    stage.width === p.width
                      ? "bg-fg text-bg"
                      : "bg-raised text-muted hover:text-fg",
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs leading-normal text-subtle">
              Ausgabe der Komposition. Rahmen gelten relativ zur Fläche.
            </p>
          </div>

          <Separator />

          <div>
            <div className="flex items-center justify-between gap-2">
              <Label>Bilder</Label>
              <span className="text-xs tabular-nums text-subtle">
                {plates.length}
              </span>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {SAMPLES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() =>
                    void addSources([{ source: s.src, name: s.label }])
                  }
                  className="overflow-hidden rounded-md text-left shadow-border transition-[box-shadow,transform] duration-150 active:scale-[0.96]"
                >
                  <img
                    src={s.src}
                    alt={s.label}
                    className="aspect-still w-full object-cover"
                  />
                  <span className="block px-2 py-1.5 text-xs font-medium text-fg">
                    + {s.label}
                  </span>
                </button>
              ))}
            </div>
            <ul className="mt-3 flex flex-col gap-1.5">
              {plates.map((plate, i) => (
                <li key={plate.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(plate.id)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left shadow-border",
                      plate.id === selected?.id
                        ? "bg-raised"
                        : "hover:bg-raised/60",
                    )}
                  >
                    <img
                      src={plate.thumb}
                      alt=""
                      className="size-8 shrink-0 rounded-sm object-cover"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium text-fg">
                        {i + 1}. {plate.name}
                      </span>
                      <span className="block text-xs tabular-nums text-subtle">
                        Start {formatMs(plate.startMs)}
                      </span>
                    </span>
                    <span className="flex shrink-0 gap-0.5">
                      <span
                        role="button"
                        tabIndex={0}
                        className="grid size-8 place-items-center text-muted hover:text-fg"
                        onClick={(e) => {
                          e.stopPropagation();
                          movePlate(plate.id, -1);
                        }}
                      >
                        <ChevronUp className="size-3.5" />
                      </span>
                      <span
                        role="button"
                        tabIndex={0}
                        className="grid size-8 place-items-center text-muted hover:text-fg"
                        onClick={(e) => {
                          e.stopPropagation();
                          movePlate(plate.id, 1);
                        }}
                      >
                        <ChevronDown className="size-3.5" />
                      </span>
                      <span
                        role="button"
                        tabIndex={0}
                        className="grid size-8 place-items-center text-muted hover:text-danger"
                        onClick={(e) => {
                          e.stopPropagation();
                          removePlate(plate.id);
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {selected && (
            <>
              <Separator />
              <fieldset className="flex flex-col gap-4">
                <legend className="text-xs font-medium tracking-wide text-muted">
                  {selected.name}
                </legend>
                <Field label="Start" value={formatMs(selected.startMs)}>
                  <Slider
                    min={0}
                    max={Math.max(duration + 8000, selected.startMs + 4000)}
                    step={100}
                    value={[selected.startMs]}
                    onValueChange={(v) =>
                      updatePlate(selected.id, { startMs: v[0] ?? 0 })
                    }
                  />
                </Field>
                <Field
                  label="Transparenz"
                  value={`${Math.round(selected.transparency)}%`}
                >
                  <Slider
                    min={0}
                    max={100}
                    step={1}
                    value={[selected.transparency]}
                    onValueChange={(v) =>
                      updatePlate(selected.id, {
                        transparency: v[0] ?? 100,
                      })
                    }
                  />
                </Field>
                <p className="text-xs leading-normal text-subtle">
                  Papier und helles Grau werden ausgestanzt. Dunkle Striche
                  bleiben, darunter liegende Bilder scheinen durch.
                </p>
                <Field
                  label="Auflösung"
                  value={formatSize(selected.params.maxSize)}
                >
                  <Slider
                    min={360}
                    max={3840}
                    step={40}
                    value={[selected.params.maxSize]}
                    onValueChange={(v) =>
                      updatePlate(selected.id, {
                        params: {
                          ...selected.params,
                          maxSize: v[0] ?? 680,
                        },
                      })
                    }
                  />
                </Field>
                <div className="flex flex-wrap gap-1.5">
                  {SIZE_PRESETS.map((p) => (
                    <button
                      key={p.size}
                      type="button"
                      onClick={() =>
                        updatePlate(selected.id, {
                          params: { ...selected.params, maxSize: p.size },
                        })
                      }
                      className={cn(
                        "h-8 rounded-md px-2.5 text-xs font-medium shadow-border transition-colors",
                        selected.params.maxSize === p.size
                          ? "bg-fg text-bg"
                          : "bg-raised text-muted hover:text-fg",
                      )}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </fieldset>

              <Separator />

              <fieldset className="flex flex-col gap-4">
                <legend className="text-xs font-medium tracking-wide text-muted">
                  Ablauf
                </legend>
                <Field
                  label="Liniendauer"
                  value={formatMs(selected.timeline.lineMs)}
                >
                  <Slider
                    min={1200}
                    max={9000}
                    step={100}
                    value={[selected.timeline.lineMs]}
                    onValueChange={(v) =>
                      updatePlate(selected.id, {
                        timeline: {
                          ...selected.timeline,
                          lineMs: v[0] ?? selected.timeline.lineMs,
                        },
                      })
                    }
                  />
                </Field>
                <Field label="Töne" value={formatMs(selected.timeline.toneMs)}>
                  <Slider
                    min={2400}
                    max={14000}
                    step={100}
                    value={[selected.timeline.toneMs]}
                    onValueChange={(v) =>
                      updatePlate(selected.id, {
                        timeline: {
                          ...selected.timeline,
                          toneMs: v[0] ?? selected.timeline.toneMs,
                        },
                      })
                    }
                  />
                </Field>
                <Field
                  label="Halten"
                  value={formatMs(selected.timeline.holdMs)}
                >
                  <Slider
                    min={400}
                    max={5000}
                    step={100}
                    value={[selected.timeline.holdMs]}
                    onValueChange={(v) =>
                      updatePlate(selected.id, {
                        timeline: {
                          ...selected.timeline,
                          holdMs: v[0] ?? selected.timeline.holdMs,
                        },
                      })
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
                <Field
                  label="Tonstufen"
                  value={String(selected.params.levels)}
                >
                  <Slider
                    min={4}
                    max={16}
                    step={1}
                    value={[selected.params.levels]}
                    onValueChange={(v) =>
                      updatePlate(selected.id, {
                        params: {
                          ...selected.params,
                          levels: v[0] ?? 10,
                        },
                      })
                    }
                  />
                </Field>
                <Field
                  label="Kanten"
                  value={`${selected.params.edgeThreshold}`}
                >
                  <Slider
                    min={8}
                    max={48}
                    step={1}
                    value={[selected.params.edgeThreshold]}
                    onValueChange={(v) =>
                      updatePlate(selected.id, {
                        params: {
                          ...selected.params,
                          edgeThreshold: v[0] ?? 20,
                        },
                      })
                    }
                  />
                </Field>
                <Field
                  label="Tusche"
                  value={`${selected.params.inkThreshold}`}
                >
                  <Slider
                    min={8}
                    max={90}
                    step={1}
                    value={[selected.params.inkThreshold]}
                    onValueChange={(v) =>
                      updatePlate(selected.id, {
                        params: {
                          ...selected.params,
                          inkThreshold: v[0] ?? 44,
                        },
                      })
                    }
                  />
                </Field>
                <Field
                  label="Feinstriche"
                  value={`${selected.params.minStroke} px`}
                >
                  <Slider
                    min={1}
                    max={14}
                    step={1}
                    value={[selected.params.minStroke]}
                    onValueChange={(v) =>
                      updatePlate(selected.id, {
                        params: {
                          ...selected.params,
                          minStroke: v[0] ?? 3,
                        },
                      })
                    }
                  />
                </Field>
                <label className="flex min-h-11 items-center gap-3 text-sm text-fg">
                  <input
                    type="checkbox"
                    checked={selected.params.includeInk}
                    onChange={(e) =>
                      updatePlate(selected.id, {
                        params: {
                          ...selected.params,
                          includeInk: e.target.checked,
                        },
                      })
                    }
                    className="size-4 accent-fg"
                  />
                  Dunkle Konturen mitzeichnen
                </label>
                <div className="flex flex-col gap-2">
                  <Button
                    type="button"
                    variant={dirty ? "default" : "secondary"}
                    onClick={() => void reprocessSelected()}
                    disabled={busy || !dirty}
                  >
                    Änderungen anwenden
                  </Button>
                  <button
                    type="button"
                    onClick={() =>
                      updatePlate(selected.id, {
                        params: { ...DEFAULT_PARAMS },
                        timeline: { ...DEFAULT_TIMELINE },
                        transparency: 100,
                      })
                    }
                    className="min-h-11 text-xs text-muted transition-colors hover:text-fg"
                  >
                    Standardwerte dieses Bildes
                  </button>
                </div>
              </fieldset>
            </>
          )}
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
