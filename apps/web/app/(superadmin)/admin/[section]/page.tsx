import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { requirePlatformAdmin } from "../../_data";

const SECTIONS: Record<string, { title: string; milestone: string }> = {
  packages: { title: "Packages", milestone: "M1" },
  billing: { title: "Billing", milestone: "M6" },
  settings: { title: "Settings", milestone: "M1" },
};

async function Placeholder({ params }: { params: PageProps<"/admin/[section]">["params"] }) {
  const { section } = await params;
  const s = SECTIONS[section];
  if (!s) notFound();
  await connection(); // the session check below reads the clock: request time only, never the prerender
  await requirePlatformAdmin();
  return (
    <main className="flex flex-col gap-2">
      <h1 className="text-2xl font-semibold">{s.title}</h1>
      <p role="status">Coming in {s.milestone}.</p>
    </main>
  );
}

export default function SectionPage({ params }: PageProps<"/admin/[section]">) {
  return (
    <Suspense fallback={null}>
      <Placeholder params={params} />
    </Suspense>
  );
}
