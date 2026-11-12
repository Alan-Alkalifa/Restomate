"use client";

import { useState } from "react";
import type { KitchenDictionary } from "@/i18n/types";
import { countByStation, visibleTickets, type KdsPayload, type StationOption } from "./kitchen-model";
import { TicketCard, type KitchenActions } from "./TicketCard";
import { useKitchenFeed } from "./use-kitchen-feed";
import { useServerNow } from "./use-server-now";

type Props = {
  payload: KdsPayload;
  stations: StationOption[];
  locationId: string;
  locationName: string;
  canUpdate: boolean;
  actions: KitchenActions;
  t: KitchenDictionary;
  /** Language links keep the rest of the URL: "?lang=id" / "?lang=en". */
  languages: { id: string; label: string; href: string; current: boolean }[];
};

export function KitchenBoard({ payload, stations, locationId, locationName, canUpdate, actions, t, languages }: Props) {
  const feed = useKitchenFeed(locationId);
  const nowMs = useServerNow(payload.now);
  const [stationId, setStationId] = useState<string | null>(null);
  const counts = countByStation(payload.tickets);
  const stationName = new Map(stations.map((s) => [s.id, s.name]));
  // A filter on a station that no longer has tickets would show an empty board with no way back: fall back to all.
  const activeStation = stationId !== null && stationName.has(stationId) ? stationId : null;
  const tickets = visibleTickets(payload.tickets, activeStation);
  const total = [...counts.values()].reduce((a, b) => a + b, 0);

  const down = !feed.online ? "offline" : feed.connection === "connected" ? null : "reconnecting";
  const chip = "flex min-h-16 items-center rounded-lg border-2 px-5 text-xl font-bold focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-teal-700";

  return (
    <div className="flex min-h-dvh flex-col bg-neutral-100 text-neutral-950 dark:bg-neutral-950 dark:text-neutral-50">
      {/* Always mounted so assistive tech announces the change when the text appears. */}
      <div role="status" aria-live="polite" data-connection={down ?? "live"}>
        {down ? (
          <p className="bg-amber-200 px-4 py-3 text-center text-xl font-bold text-amber-950">
            <span aria-hidden>⚠ </span>{down === "offline" ? t.offline : t.reconnecting}
          </p>
        ) : null}
      </div>
      <header className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b-2 border-neutral-300 bg-white px-4 py-3 dark:border-neutral-700 dark:bg-neutral-900">
        <div>
          <h1 className="text-3xl font-extrabold">{t.title}</h1>
          <p className="text-lg">{locationName}</p>
        </div>
        <nav aria-label={t.stationFilter} className="flex flex-1 flex-wrap items-center gap-2">
          <button type="button" aria-pressed={activeStation === null} onClick={() => setStationId(null)}
            className={`${chip} ${activeStation === null ? "border-teal-800 bg-teal-700 text-white" : "border-neutral-400 bg-white dark:bg-neutral-800"}`}>
            {t.allStations} <span className="ml-2 tabular-nums">{total}</span>
          </button>
          {stations.map((s) => (
            <button key={s.id} type="button" aria-pressed={activeStation === s.id} onClick={() => setStationId(s.id)}
              className={`${chip} ${activeStation === s.id ? "border-teal-800 bg-teal-700 text-white" : "border-neutral-400 bg-white dark:bg-neutral-800"}`}>
              {s.name} <span className="ml-2 tabular-nums">{counts.get(s.id) ?? 0}</span>
            </button>
          ))}
        </nav>
        <div className="flex items-center gap-3 text-base">
          {!canUpdate ? <span className="rounded bg-neutral-200 px-2 py-1 font-semibold dark:bg-neutral-700">{t.readOnly}</span> : null}
          <span className={`font-bold ${down ? "text-amber-800 dark:text-amber-300" : "text-green-800 dark:text-green-300"}`}>
            <span aria-hidden>● </span>{down ? (down === "offline" ? t.chipOffline : t.chipReconnecting) : t.live}
          </span>
          <nav aria-label={t.language} className="flex gap-1">
            {languages.map((l) => (
              l.current
                ? <span key={l.id} lang={l.id} aria-current="true" className="flex min-h-12 items-center px-3 font-bold">{l.label}</span>
                // A real navigation, not a client transition: the page's <html lang> follows the document.
                : <a key={l.id} lang={l.id} hrefLang={l.id} href={l.href} className="flex min-h-12 items-center px-3 underline">{l.label}</a>
            ))}
          </nav>
        </div>
      </header>

      <main className="flex-1 p-4" aria-busy={feed.refreshing}>
        {tickets.length === 0 ? (
          <div className="mx-auto mt-16 max-w-md text-center">
            <p className="text-4xl font-extrabold">{activeStation === null ? t.empty : t.emptyStation}</p>
            <p className="mt-3 text-xl">{t.emptyHint}</p>
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {tickets.map((ticket) => (
              <TicketCard
                key={ticket.id}
                ticket={ticket}
                stationName={stations.length > 1 ? stationName.get(ticket.stationId) ?? null : null}
                nowMs={nowMs}
                canUpdate={canUpdate}
                actions={actions}
                onChanged={feed.refresh}
                t={t}
              />
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
