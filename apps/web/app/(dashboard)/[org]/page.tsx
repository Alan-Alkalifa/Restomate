import Link from "next/link";
import { Suspense } from "react";
import { resolveNav } from "@/components/dashboard/nav";
import { requireOrgContext } from "../_data";

// Static M0 checklist; real progress tracking is M1.
const CHECKLIST = [
  { key: "settings", label: "Add location details", href: "settings" },
  { key: "staff", label: "Invite your staff", href: "staff" },
  { key: "settings", label: "Set your branding", href: "settings" },
] as const;

async function Home({ params }: { params: PageProps<"/[org]">["params"] }) {
  const { org } = await params;
  const ctx = await requireOrgContext(org);
  const can = new Set(ctx.permissions);
  const firstLocation = ctx.locations[0];
  const firstSection = resolveNav(ctx).find((i) => i.scope === "location" && !i.locked);
  return (
    <main className="flex max-w-2xl flex-col gap-6">
      <h1 className="text-2xl font-semibold break-words">Welcome to {ctx.org.name}</h1>
      {firstLocation && firstSection && (
        <Link href={`/${ctx.org.slug}/${firstLocation.id}/${firstSection.key}`} className="flex min-h-12 w-fit items-center rounded-lg bg-teal-700 px-5 font-semibold text-white">
          Open {firstLocation.name}
        </Link>
      )}
      <section aria-labelledby="setup" className="flex flex-col gap-3">
        <h2 id="setup" className="text-lg font-semibold">Set up your restaurant</h2>
        <ul className="flex flex-col gap-2">
          {CHECKLIST.map((c) => (
            <li key={c.label} className="flex min-h-12 items-center gap-3 rounded-lg border border-neutral-300 px-3 dark:border-neutral-700">
              <span aria-hidden>☐</span>
              {can.has(c.key === "staff" ? "staff.manage" : "settings.manage") ? (
                <Link href={`/${ctx.org.slug}/${c.href}`} className="underline">{c.label}</Link>
              ) : (
                <span>{c.label}</span>
              )}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

export default function OrgHomePage({ params }: PageProps<"/[org]">) {
  return (
    <Suspense fallback={null}>
      <Home params={params} />
    </Suspense>
  );
}
