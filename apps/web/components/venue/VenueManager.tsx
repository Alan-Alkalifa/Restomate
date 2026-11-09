"use client";

import Link from "next/link";
import { useState } from "react";
import { AreasPanel } from "./AreasPanel";
import { TablesPanel } from "./TablesPanel";
import type { VenueActions, VenueData } from "./types";
import { useOnline } from "./use-online";

/** "12 / 20 tables"; a null max means the plan has no limit. */
export function usageText({ used, max }: VenueData["tableLimit"]): string {
  return max === null ? `${used} tables (no limit)` : `${used} / ${max} tables`;
}

export function VenueManager({ data, actions, upgradeHref }: { data: VenueData; actions: VenueActions; upgradeHref: string }) {
  const offline = !useOnline();
  const [notice, setNotice] = useState<string | null>(null);
  const { tableLimit, canManage } = data;
  const atLimit = tableLimit.max !== null && tableLimit.used >= tableLimit.max;
  return (
    <div className="flex flex-col gap-6">
      {offline && (
        <p role="status" className="rounded-lg border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-50">
          You&apos;re offline. You can keep looking, but changes can&apos;t be saved until you reconnect.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm font-medium" aria-label="Plan usage">{usageText(tableLimit)}</p>
        {atLimit && canManage && <Link href={upgradeHref} className="flex min-h-12 items-center text-sm font-medium underline">Upgrade plan</Link>}
      </div>
      {!canManage && <p className="text-sm text-neutral-600 dark:text-neutral-400">You can view areas and tables. Ask a manager to make changes.</p>}
      <div role="status" aria-live="polite">
        {notice && <p className="rounded-lg border border-teal-300 bg-teal-50 px-3 py-2 text-sm text-teal-950 dark:border-teal-800 dark:bg-teal-950 dark:text-teal-50">{notice}</p>}
      </div>
      <AreasPanel areas={data.areas} canManage={canManage} actions={actions} offline={offline} upgradeHref={upgradeHref} />
      <TablesPanel areas={data.areas} tables={data.tables} canManage={canManage} atLimit={atLimit} actions={actions} offline={offline} upgradeHref={upgradeHref} onNotice={setNotice} />
    </div>
  );
}
