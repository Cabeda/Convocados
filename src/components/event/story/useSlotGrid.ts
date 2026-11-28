/* eslint-disable react-hooks/set-state-in-effect -- the width is read from the page after layout, before the first paint. */
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { SLOT_GAP, SLOT_MAX_SIZE, fitColumns, maxAcross, slotMinSize, slotRows } from "~/lib/nextGame";

/**
 * Where each slot of the lineup sits: rows as even as the people split (22 → 8 + 7 + 7), for the width the
 * page really has (a narrow screen wraps to more rows, still even). The width is read from a wrapper before
 * the first paint, so the real lineup and its loading skeleton draw the same rows and nothing moves.
 */
export function useSlotGrid(maxPlayers: number) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(() => setWidth(el.clientWidth));
    watch.observe(el);
    return () => watch.disconnect();
  }, []);

  return useMemo(() => {
    const rows = slotRows(maxPlayers, fitColumns(width, slotMinSize(maxPlayers), SLOT_GAP, maxAcross(maxPlayers)));
    const columns = rows[0] ?? 1;
    const rowOf: number[] = [];
    const colOf: number[] = [];
    rows.forEach((size, r) => { for (let c = 0; c < size; c++) { rowOf.push(r); colOf.push(c); } });
    return {
      wrapRef, rows, columns, rowOf, colOf,
      /** The grid itself: no wider than its slots at their biggest. */
      gridSx: {
        display: "grid", gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: `${SLOT_GAP}px`,
        maxWidth: columns * SLOT_MAX_SIZE + (columns - 1) * SLOT_GAP,
      } as const,
    };
  }, [maxPlayers, width]);
}
