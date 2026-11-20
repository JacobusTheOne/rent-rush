"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { gridPosition } from "@/game/board";

const MAX_ZOOM = 2;

interface Zoom {
  s: number;
  x: number;
  y: number;
}

/**
 * Square window onto the board with zoom (up to 2x) and pan:
 * buttons, Ctrl + mouse wheel / trackpad pinch, double-click, two-finger pinch,
 * and drag to pan while zoomed. `overlay` (dice cup + turn controls) sits on top
 * in the middle of the window and never zooms, so it can't be panned away.
 * While zoomed, the view follows the square in `follow` (the moving piece).
 */
export function BoardViewport({
  children,
  overlay,
  follow,
}: {
  children: React.ReactNode;
  overlay?: React.ReactNode;
  follow?: number | null;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState<Zoom>({ s: 1, x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ dist: number; mid: { x: number; y: number }; start: Zoom } | null>(null);
  const moved = useRef(false);

  const size = () => box.current?.clientWidth ?? 1;

  const clamp = useCallback((s: number, x: number, y: number): Zoom => {
    const z = Math.min(MAX_ZOOM, Math.max(1, s));
    const min = size() - size() * z;
    return { s: z, x: Math.min(0, Math.max(min, x)), y: Math.min(0, Math.max(min, y)) };
  }, []);

  /** Zoom to `s`, keeping the point (cx, cy) of the window where it is. */
  const zoomAt = useCallback(
    (s: number, cx: number, cy: number) =>
      setZoom((z) => {
        const next = Math.min(MAX_ZOOM, Math.max(1, s));
        const k = next / z.s;
        return clamp(next, cx - (cx - z.x) * k, cy - (cy - z.y) * k);
      }),
    [clamp],
  );

  const local = (clientX: number, clientY: number) => {
    const r = box.current!.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  };

  // Ctrl + wheel (and trackpad pinch, which browsers send as Ctrl + wheel). A plain wheel scrolls the page.
  useEffect(() => {
    const el = box.current!;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const p = local(e.clientX, e.clientY);
      setZoom((z) => {
        const next = Math.min(MAX_ZOOM, Math.max(1, z.s * Math.exp(-e.deltaY * 0.01)));
        const k = next / z.s;
        return clamp(next, p.x - (p.x - z.x) * k, p.y - (p.y - z.y) * k);
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [clamp]);

  // Keep the zoom valid when the window is resized.
  useEffect(() => {
    const ro = new ResizeObserver(() => setZoom((z) => clamp(z.s, z.x, z.y)));
    ro.observe(box.current!);
    return () => ro.disconnect();
  }, [clamp]);

  // Follow the moving piece while zoomed in.
  useEffect(() => {
    if (follow == null) return;
    setZoom((z) => {
      if (z.s <= 1) return z;
      const { row, col } = gridPosition(follow);
      const cell = size() / 7;
      const cx = (col - 0.5) * cell;
      const cy = (row - 0.5) * cell;
      return clamp(z.s, size() / 2 - cx * z.s, size() / 2 - cy * z.s);
    });
  }, [follow, clamp]);

  const interactive = (t: EventTarget | null) =>
    t instanceof Element && !!t.closest("button, a, input, dialog, .center-hud, .dice-cup.can-roll canvas");

  const onPointerDown = (e: React.PointerEvent) => {
    if (interactive(e.target) || e.button > 0) return;
    pointers.current.set(e.pointerId, local(e.clientX, e.clientY));
    moved.current = false;
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = {
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        start: zoom,
      };
    }
    if (zoom.s > 1 || pointers.current.size === 2) {
      e.currentTarget.setPointerCapture(e.pointerId);
      setDragging(true);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const p = local(e.clientX, e.clientY);
    pointers.current.set(e.pointerId, p);
    if (pointers.current.size === 2 && gesture.current) {
      const [a, b] = [...pointers.current.values()];
      const g = gesture.current;
      const s = g.start.s * (Math.hypot(a.x - b.x, a.y - b.y) / g.dist);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const k = Math.min(MAX_ZOOM, Math.max(1, s)) / g.start.s;
      setZoom(clamp(s, mid.x - (g.mid.x - g.start.x) * k, mid.y - (g.mid.y - g.start.y) * k));
      moved.current = true;
    } else if (zoom.s > 1) {
      const dx = p.x - prev.x;
      const dy = p.y - prev.y;
      if (Math.abs(dx) + Math.abs(dy) > 0) moved.current = true;
      setZoom((z) => clamp(z.s, z.x + dx, z.y + dy));
    }
  };

  const onPointerEnd = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) gesture.current = null;
    if (pointers.current.size === 0) setDragging(false);
  };

  const center = () => size() / 2;
  const pct = Math.round(zoom.s * 100);

  return (
    <div
      ref={box}
      className={`board-viewport ${zoom.s > 1 ? "zoomed" : ""} ${dragging ? "dragging" : ""}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onDoubleClick={(e) => {
        if (interactive(e.target)) return;
        const p = local(e.clientX, e.clientY);
        if (zoom.s > 1) setZoom({ s: 1, x: 0, y: 0 });
        else zoomAt(MAX_ZOOM, p.x, p.y);
      }}
    >
      <div
        className="board-zoom"
        style={{ transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.s})` }}
      >
        {children}
      </div>
      {overlay && <div className="board-overlay">{overlay}</div>}
      <div className="zoom-controls" role="group" aria-label="Board zoom">
        <button type="button" aria-label="Zoom out" disabled={zoom.s <= 1} onClick={() => zoomAt(zoom.s - 0.5, center(), center())}>
          −
        </button>
        <span className="zoom-level" aria-live="polite">
          {pct}%
        </span>
        <button type="button" aria-label="Zoom in" disabled={zoom.s >= MAX_ZOOM} onClick={() => zoomAt(zoom.s + 0.5, center(), center())}>
          +
        </button>
        <button type="button" aria-label="Fit the whole board" disabled={zoom.s <= 1} onClick={() => setZoom({ s: 1, x: 0, y: 0 })}>
          ⤢
        </button>
      </div>
    </div>
  );
}
