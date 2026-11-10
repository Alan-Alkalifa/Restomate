"use client";

import { useRouter } from "next/navigation";
import { startTransition, useActionState, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { venueErrorMessage } from "../errors";
import type { ActionResult, BoundVenueAction, VenueData, VenueTable } from "../types";
import { useOnline } from "../use-online";
import { countChanged, diffPositions, firstFreeSpot, insideRect, nudge, pointerToGrid, samePos, type Pos, type PositionMap } from "./grid";

export type FloorData = Pick<VenueData, "areas" | "tables" | "canManage">;

type Drag = { id: string; from: "tray" | "canvas"; pos: Pos | null };

const SIZE: Record<VenueTable["shape"], string> = {
  square: "h-[9%] w-[9%]",
  round: "h-[9%] w-[9%] rounded-full",
  rect: "h-[8%] w-[14%]",
};

function initialPositions(tables: VenueTable[]): PositionMap {
  const m: PositionMap = {};
  for (const t of tables) m[t.id] = t.posX != null && t.posY != null ? { x: t.posX, y: t.posY } : null;
  return m;
}

function errorSummary(r: ActionResult | null): string | undefined {
  if (!r || r.ok) return undefined;
  const parts = [venueErrorMessage(r)];
  for (const [name, msgs] of Object.entries(r.fieldErrors ?? {})) {
    if (msgs?.length) parts.push(`${name === "positions" ? "Positions" : name}: ${msgs.join(" ")}`);
  }
  return parts.filter(Boolean).join(" ") || undefined;
}

/**
 * Floor plan editor. Pointer events (mouse, touch, pen) with grid snapping, a tray for unplaced tables, arrow keys for
 * keyboard placement. Only changed positions are sent, as the JSON `positions` field of a server action that already
 * has the org and location bound; no organization id is ever in the payload.
 */
export function FloorPlan({ data, saveAction }: { data: FloorData; saveAction: BoundVenueAction }) {
  const router = useRouter();
  const online = useOnline();
  const { canManage } = data;
  const areas = useMemo(() => data.areas.filter((a) => a.isActive).sort((a, b) => a.sortOrder - b.sortOrder), [data.areas]);
  const tables = useMemo(() => data.tables.filter((t) => t.isActive), [data.tables]);

  const [areaId, setAreaId] = useState(areas[0]?.id ?? "");
  const [base, setBase] = useState<PositionMap>(() => initialPositions(tables));
  const [pos, setPos] = useState<PositionMap>(() => initialPositions(tables));
  const [selected, setSelected] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const sentRef = useRef<PositionMap>({});

  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(saveAction, null);

  const changes = diffPositions(base, pos);
  const dirtyCount = countChanged(base, pos);
  const dirty = dirtyCount > 0;
  const areaTables = tables.filter((t) => t.areaId === areaId);
  const placed = areaTables.filter((t) => pos[t.id]);
  const unplaced = areaTables.filter((t) => !pos[t.id]);

  // After a successful save the sent positions become the new baseline (no reload needed).
  const ok = state?.ok === true;
  useEffect(() => {
    if (!ok) return;
    setBase((cur) => ({ ...cur, ...sentRef.current }));
    router.refresh();
  }, [state, ok, router]);

  // Warn before leaving with unsaved changes: tab close/reload, and in-app link clicks.
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || e.defaultPrevented || e.metaKey || e.ctrlKey) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || url.pathname + url.search === location.pathname + location.search) return;
      if (!window.confirm("You have unsaved floor plan changes. Leave without saving?")) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);

  const setOne = (id: string, p: Pos) => setPos((cur) => (samePos(cur[id], p) ? cur : { ...cur, [id]: p }));

  function startDrag(e: React.PointerEvent<HTMLElement>, id: string, from: Drag["from"]) {
    if (!canManage || pending || (e.pointerType === "mouse" && e.button !== 0)) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setSelected(id);
    setDrag({ id, from, pos: from === "canvas" ? pos[id] : null });
  }
  function moveDrag(e: React.PointerEvent<HTMLElement>) {
    if (!drag || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const inside = insideRect(e.clientX, e.clientY, rect);
    // Canvas tables always stay on the plan (clamped); a tray table only shows once the pointer is over the plan.
    setDrag({ ...drag, pos: drag.from === "canvas" || inside ? pointerToGrid(e.clientX, e.clientY, rect) : null });
  }
  function endDrag(commit: boolean) {
    if (drag && commit && drag.pos) setOne(drag.id, drag.pos);
    setDrag(null);
  }

  function onTableKey(e: React.KeyboardEvent, id: string) {
    if (!canManage) return;
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    const cur = pos[id];
    if (!d || !cur) return;
    e.preventDefault();
    const k = e.shiftKey ? 5 : 1;
    setOne(id, nudge(cur, d[0] * k, d[1] * k));
  }
  function placeFromTray(id: string) {
    const taken = placed.map((t) => pos[t.id]!).filter(Boolean);
    setOne(id, firstFreeSpot(taken));
    setSelected(id);
    // The table mounts on the plan after this render; focus it then so the arrow keys work straight away.
    requestAnimationFrame(() => canvasRef.current?.querySelector<HTMLElement>(`[data-table-id="${CSS.escape(id)}"]`)?.focus());
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    // Not <form action>: React 19 would reset the form after an error result. The payload is built here anyway.
    e.preventDefault();
    if (!dirty || !online || pending || !canManage) return;
    sentRef.current = Object.fromEntries(changes.map((c) => [c.tableId, { x: c.posX, y: c.posY }]));
    const fd = new FormData();
    fd.set("positions", JSON.stringify(changes));
    startTransition(() => formAction(fd));
  }

  if (areas.length === 0) {
    return <p className="rounded-xl border border-dashed border-neutral-400 p-6 text-sm">Add an area and some tables first, then arrange them here.</p>;
  }

  const ghost = drag?.from === "tray" && drag.pos ? tables.find((t) => t.id === drag.id) : undefined;
  const more = dirtyCount > changes.length;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <div role="group" aria-label="Area" className="flex flex-wrap gap-2">
        {areas.map((a) => (
          <button
            key={a.id}
            type="button"
            aria-pressed={a.id === areaId}
            onClick={() => { setAreaId(a.id); setSelected(null); }}
            className={`min-h-12 rounded-lg px-4 text-sm font-medium ring-1 ring-neutral-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 ${a.id === areaId ? "bg-teal-700 text-white ring-teal-700" : "hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}
          >
            {a.name}
          </button>
        ))}
      </div>

      {!canManage && <p role="note" className="text-sm text-neutral-600 dark:text-neutral-400">View only. You need permission to manage tables to move them.</p>}
      {!online && <p role="status" className="text-sm text-amber-800 dark:text-amber-300">You&apos;re offline. Reconnect to save.</p>}
      <FormAlert message={errorSummary(state)} />
      {ok && !dirty && <FormAlert tone="info" message="Floor plan saved." />}

      {areaTables.length === 0 ? (
        <p className="rounded-xl border border-dashed border-neutral-400 p-6 text-sm">This area has no active tables yet.</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_16rem]">
          <div
            ref={canvasRef}
            role="application"
            aria-label={`Floor plan for ${areas.find((a) => a.id === areaId)?.name ?? "area"}${canManage ? ". Select a table and use the arrow keys to move it." : ""}`}
            className="relative aspect-square w-full max-w-[min(100%,75vh)] touch-none overflow-hidden rounded-xl border border-neutral-400 bg-neutral-50 [background-image:linear-gradient(to_right,rgb(0_0_0/0.07)_1px,transparent_1px),linear-gradient(to_bottom,rgb(0_0_0/0.07)_1px,transparent_1px)] [background-size:10%_10%] dark:bg-neutral-900 dark:[background-image:linear-gradient(to_right,rgb(255_255_255/0.08)_1px,transparent_1px),linear-gradient(to_bottom,rgb(255_255_255/0.08)_1px,transparent_1px)]"
          >
            {placed.map((t) => {
              const p = drag?.id === t.id && drag.pos ? drag.pos : pos[t.id]!;
              return (
                <button
                  key={t.id}
                  type="button"
                  data-table-id={t.id}
                 
                  aria-label={`Table ${t.label}, ${t.capacity} seats, ${t.shape}${canManage ? `, position ${p.x}, ${p.y}` : ""}`}
                  aria-pressed={selected === t.id}
                  onPointerDown={(e) => startDrag(e, t.id, "canvas")}
                  onPointerMove={moveDrag}
                  onPointerUp={() => endDrag(true)}
                  onPointerCancel={() => endDrag(false)}
                  onKeyDown={(e) => onTableKey(e, t.id)}
                  onFocus={() => setSelected(t.id)}
                  style={{ left: `${(p.x / 1000) * 100}%`, top: `${(p.y / 1000) * 100}%` }}
                  className={`absolute flex min-h-12 min-w-12 -translate-x-1/2 -translate-y-1/2 touch-none select-none flex-col items-center justify-center rounded-md border-2 bg-white text-xs font-semibold leading-tight text-neutral-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 dark:bg-neutral-800 dark:text-neutral-100 ${SIZE[t.shape]} ${selected === t.id ? "border-teal-700" : "border-neutral-500"} ${canManage ? "cursor-grab active:cursor-grabbing" : "cursor-default"} ${drag?.id === t.id ? "z-10 shadow-lg" : ""}`}
                >
                  <span className="max-w-full truncate px-1">{t.label}</span>
                  <span className="font-normal text-neutral-600 dark:text-neutral-400">{t.capacity}</span>
                </button>
              );
            })}
            {ghost && drag?.pos && (
              <div
                aria-hidden
                style={{ left: `${(drag.pos.x / 1000) * 100}%`, top: `${(drag.pos.y / 1000) * 100}%` }}
                className={`pointer-events-none absolute z-10 flex min-h-12 min-w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-md border-2 border-teal-700 bg-teal-50 text-xs font-semibold text-neutral-900 opacity-80 ${SIZE[ghost.shape]}`}
              >
                {ghost.label}
              </div>
            )}
          </div>

          <section aria-label="Tables not placed" className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold">Not placed ({unplaced.length})</h2>
            {unplaced.length === 0 && <p className="text-sm text-neutral-600 dark:text-neutral-400">Every table in this area is on the plan.</p>}
            {unplaced.length > 0 && canManage && <p className="text-xs text-neutral-600 dark:text-neutral-400">Drag onto the plan, or press Enter on a table to place it.</p>}
            <ul className="flex flex-wrap gap-2 lg:flex-col">
              {unplaced.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    disabled={!canManage}
                    aria-label={`Place table ${t.label}, ${t.capacity} seats`}
                    onPointerDown={(e) => startDrag(e, t.id, "tray")}
                    onPointerMove={moveDrag}
                    onPointerUp={() => endDrag(true)}
                    onPointerCancel={() => endDrag(false)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        placeFromTray(t.id);
                      }
                    }}
                    className="flex min-h-12 w-full touch-none select-none items-center gap-2 rounded-lg px-3 text-sm ring-1 ring-neutral-400 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:cursor-default disabled:opacity-70 dark:hover:bg-neutral-800"
                  >
                    <span className="font-semibold">{t.label}</span>
                    <span className="text-neutral-600 dark:text-neutral-400">{t.capacity} seats</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}

      {canManage && (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" pending={pending} disabled={!dirty || !online}>{pending ? "Saving…" : "Save positions"}</Button>
          <button type="button" disabled={!dirty || pending} onClick={() => setPos(base)} className="min-h-12 rounded-lg px-4 ring-1 ring-neutral-400 disabled:opacity-60">Discard changes</button>
          <p role="status" className="text-sm text-neutral-700 dark:text-neutral-300">
            {dirty ? `${dirtyCount} unsaved ${dirtyCount === 1 ? "change" : "changes"}${more ? ` (saving ${changes.length} at a time)` : ""}` : "All changes saved"}
          </p>
        </div>
      )}
    </form>
  );
}
