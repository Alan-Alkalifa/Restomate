import Link from "next/link";

/** Shared tab bar for the two menu pages. "Menu items" is shown only to members who can manage the menu. */
export function MenuTabs({ orgSlug, locationId, current, canManage }: { orgSlug: string; locationId: string | null; current: "items" | "location"; canManage: boolean }) {
  const tab = (href: string, label: string, on: boolean) => (
    <Link
      href={href}
      aria-current={on ? "page" : undefined}
      className={`flex min-h-12 items-center rounded-lg px-4 text-sm font-medium ring-1 ring-neutral-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 ${on ? "bg-teal-700 text-white ring-teal-700" : "hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}
    >
      {label}
    </Link>
  );
  return (
    <nav aria-label="Menu views" className="flex gap-2">
      {canManage && tab(`/${orgSlug}/menu`, "Menu items", current === "items")}
      {locationId && tab(`/${orgSlug}/${locationId}/menu`, "This location", current === "location")}
    </nav>
  );
}
