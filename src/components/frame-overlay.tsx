import {
  useEffect,
  useLayoutEffect,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import type { FrameRect, Plate } from "@/lib/graphite/types";
import { clampFrame } from "@/lib/graphite/compose";
import { cn } from "@/lib/utils";

type Handle = "move" | "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se";

const HANDLES: { id: Handle; className: string; cursor: string }[] = [
  { id: "nw", className: "left-0 top-0", cursor: "nwse-resize" },
  { id: "ne", className: "right-0 top-0", cursor: "nesw-resize" },
  { id: "sw", className: "bottom-0 left-0", cursor: "nesw-resize" },
  { id: "se", className: "bottom-0 right-0", cursor: "nwse-resize" },
  { id: "n", className: "left-1/2 top-0", cursor: "ns-resize" },
  { id: "s", className: "bottom-0 left-1/2", cursor: "ns-resize" },
  { id: "w", className: "left-0 top-1/2", cursor: "ew-resize" },
  { id: "e", className: "right-0 top-1/2", cursor: "ew-resize" },
];

function applyHandle(
  start: FrameRect,
  handle: Handle,
  dx: number,
  dy: number,
): FrameRect {
  const next = { ...start };
  if (handle === "move") {
    next.x += dx;
    next.y += dy;
    return clampFrame(next);
  }
  if (handle.includes("w")) {
    next.x += dx;
    next.w -= dx;
  }
  if (handle.includes("e")) next.w += dx;
  if (handle.includes("n")) {
    next.y += dy;
    next.h -= dy;
  }
  if (handle.includes("s")) next.h += dy;
  return clampFrame(next);
}

export function FrameOverlay({
  wrapRef,
  canvasRef,
  plates,
  selectedId,
  onSelect,
  onChangeFrame,
}: {
  wrapRef: RefObject<HTMLElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  plates: Plate[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onChangeFrame: (id: string, frame: FrameRect) => void;
}) {
  const [box, setBox] = useState({ left: 0, top: 0, width: 0, height: 0 });
  const [, primed] = useState(0);
  useLayoutEffect(() => {
    primed(1);
  }, []);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const measure = () => {
      const wr = wrap.getBoundingClientRect();
      const cr = canvas.getBoundingClientRect();
      setBox({
        left: cr.left - wr.left,
        top: cr.top - wr.top,
        width: cr.width,
        height: cr.height,
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    ro.observe(canvas);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [wrapRef, canvasRef, plates.length]);

  const onDown = (
    e: ReactPointerEvent,
    id: string,
    handle: Handle,
    frame: FrameRect,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    onSelect(id);
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const originX = e.clientX;
    const originY = e.clientY;
    const start = frame;
    const w = box.width || 1;
    const h = box.height || 1;

    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - originX) / w;
      const dy = (ev.clientY - originY) / h;
      onChangeFrame(id, applyHandle(start, handle, dx, dy));
    };
    const up = (ev: PointerEvent) => {
      target.releasePointerCapture(ev.pointerId);
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
  };

  if (box.width < 8 || box.height < 8) return null;

  const ordered = [...plates].sort((a, b) =>
    a.id === selectedId ? 1 : b.id === selectedId ? -1 : 0,
  );

  return (
    <div
      className="pointer-events-none absolute touch-none"
      style={{
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
      }}
    >
      {ordered.map((plate) => {
        const selected = plate.id === selectedId;
        const label = plates.findIndex((p) => p.id === plate.id) + 1;
        return (
          <div
            key={plate.id}
            className={cn(
              "pointer-events-auto absolute border",
              selected
                ? "z-10 border-ink"
                : "border-ink/35 hover:border-ink/70",
            )}
            style={{
              left: `${plate.frame.x * 100}%`,
              top: `${plate.frame.y * 100}%`,
              width: `${plate.frame.w * 100}%`,
              height: `${plate.frame.h * 100}%`,
              cursor: "move",
            }}
            onPointerDown={(e) => onDown(e, plate.id, "move", plate.frame)}
          >
            <div className="absolute left-1 top-1 flex items-center gap-1 bg-ink px-1.5 py-0.5 text-paper">
              <span className="text-xs font-medium tabular-nums">{label}</span>
              <span className="max-w-28 truncate text-xs">{plate.name}</span>
            </div>
            {selected &&
              HANDLES.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  aria-label={`Rahmen ${h.id}`}
                  className={cn(
                    "absolute z-20 grid size-11 -translate-x-1/2 -translate-y-1/2 place-items-center",
                    h.className,
                  )}
                  style={{ cursor: h.cursor }}
                  onPointerDown={(e) => onDown(e, plate.id, h.id, plate.frame)}
                >
                  <span className="size-3 rounded-sm bg-ink" />
                </button>
              ))}
          </div>
        );
      })}
    </div>
  );
}
