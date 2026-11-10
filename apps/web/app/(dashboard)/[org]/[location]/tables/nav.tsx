import Link from "next/link";

/** List / Floor plan switch shown at the top of both tables views. */
export function TablesNav({ base, current }: { base: string; current: "list" | "floor" }) {
  const item = (href: string, label: string, on: boolean) => (
    <Link
      href={href}
      aria-current={on ? "page" : undefined}
      className={`flex min-h-12 items-center rounded-lg px-4 text-sm font-medium ring-1 ring-neutral-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 ${on ? "bg-teal-700 text-white ring-teal-700" : "hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}
    >
      {label}
    </Link>
  );
  return (
    <nav aria-label="Tables views" className="flex gap-2">
      {item(base, "List", current === "list")}
      {item(`${base}/floor`, "Floor plan", current === "floor")}
    </nav>
  );
}
