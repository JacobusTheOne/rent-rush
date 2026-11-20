"use client";

/**
 * Square window onto the board. `overlay` (dice cup + turn controls) sits on top,
 * over the board's centre area inside the ring of squares.
 */
export function BoardViewport({ children, overlay }: { children: React.ReactNode; overlay?: React.ReactNode }) {
  return (
    <div className="board-viewport">
      {children}
      {overlay && <div className="board-overlay">{overlay}</div>}
    </div>
  );
}
