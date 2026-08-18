import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { plateDuration } from "@/lib/graphite/compose";
import type { Plate } from "@/lib/graphite/types";
import { cn } from "@/lib/utils";

function formatMs(ms: number) {
  return `${(ms / 1000).toFixed(1)} s`;
}

function snapStart(ms: number, anchors: number[]): number {
  let next = Math.max(0, Math.round(ms / 100) * 100);
  let best = 80;
  for (const a of anchors) {
    const d = Math.abs(next - a);
    if (d < best) {
      best = d;
      next = Math.max(0, a);
    }
  }
  return next;
}

export function TimelineTrack({
  plates,
  selectedId,
  tMs,
  duration,
  disabled,
  onSelect,
  onSeek,
  onMoveStart,
}: {
  plates: Plate[];
  selectedId: string | null;
  tMs: number;
  duration: number;
  disabled?: boolean;
  onSelect: (id: string) => void;
  onSeek: (ms: number) => void;
  onMoveStart: (id: string, startMs: number) => void;
}) {
  const [dragSpan, setDragSpan] = useState<number | null>(null);
  const dragRef = useRef<{
    id: string;
    grab: number;
    originX: number;
    moved: boolean;
  } | null>(null);
  const span = Math.max(dragSpan ?? duration + 4000, 1000);
  const playLeft = Math.min(100, (tMs / span) * 100);

  const anchorsFor = (id: string) => {
    const marks = [0];
    for (const plate of plates) {
      if (plate.id === id) continue;
      marks.push(plate.startMs);
      marks.push(plate.startMs + plateDuration(plate));
    }
    return marks;
  };

  const msAt = (el: HTMLElement, clientX: number) => {
    const rect = el.getBoundingClientRect();
    const x = (clientX - rect.left) / Math.max(1, rect.width);
    return Math.max(0, x * span);
  };

  const onBarDown = (e: ReactPointerEvent<HTMLDivElement>, plate: Plate) => {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    onSelect(plate.id);
    const track = e.currentTarget.parentElement;
    if (!track) return;
    const pointer = msAt(track, e.clientX);
    dragRef.current = {
      id: plate.id,
      grab: pointer - plate.startMs,
      originX: e.clientX,
      moved: false,
    };
    setDragSpan(Math.max(duration + 8000, plate.startMs + plateDuration(plate) + 8000));
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onBarMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const track = e.currentTarget.parentElement;
    if (!drag || !track) return;
    const pointer = msAt(track, e.clientX);
    if (Math.abs(e.clientX - drag.originX) > 4) drag.moved = true;
    const next = snapStart(pointer - drag.grab, anchorsFor(drag.id));
    if (pointer > span * 0.9) {
      setDragSpan((s) => Math.max(s ?? span, pointer + 4000));
    }
    onMoveStart(drag.id, next);
  };

  const onBarUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    setDragSpan(null);
    if (!drag) return;
    if (!drag.moved) onSeek(plates.find((p) => p.id === drag.id)?.startMs ?? 0);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  };

  if (plates.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <div className="relative flex flex-col gap-1">
        {plates.map((plate, i) => {
          const spanMs = plateDuration(plate);
          const left = (plate.startMs / span) * 100;
          const width = Math.max(2.4, (spanMs / span) * 100);
          const selected = plate.id === selectedId;
          return (
            <div
              key={plate.id}
              className="relative h-9 overflow-hidden rounded-md bg-raised"
              onPointerDown={(e) => {
                if (disabled) return;
                if ((e.target as HTMLElement).dataset.clip) return;
                onSeek(msAt(e.currentTarget, e.clientX));
              }}
            >
              <div
                data-clip="1"
                role="slider"
                aria-label={`${plate.name} Start`}
                aria-valuemin={0}
                aria-valuenow={Math.round(plate.startMs)}
                aria-valuetext={formatMs(plate.startMs)}
                tabIndex={0}
                className={cn(
                  "absolute top-1 h-7 cursor-grab touch-none rounded-sm px-2 text-left text-xs text-ink active:cursor-grabbing",
                  selected ? "z-10 bg-accent" : "bg-accent/55 hover:bg-accent/80",
                  disabled && "pointer-events-none opacity-60",
                )}
                style={{ left: `${left}%`, width: `${width}%` }}
                onPointerDown={(e) => onBarDown(e, plate)}
                onPointerMove={onBarMove}
                onPointerUp={onBarUp}
                onPointerCancel={onBarUp}
              >
                <span className="block truncate leading-7">
                  {i + 1} · {plate.name}
                </span>
              </div>
            </div>
          );
        })}
        <div
          className="pointer-events-none absolute inset-y-0 z-20 w-px bg-fg"
          style={{ left: `${playLeft}%` }}
        />
      </div>
      <div className="flex justify-between text-xs tabular-nums text-subtle">
        <span>0.0 s</span>
        <span>Balken ziehen setzt den Start</span>
        <span>{formatMs(span)}</span>
      </div>
    </div>
  );
}
