import Link from "next/link";
import { Suspense } from "react";
import { resolveNav } from "@/components/dashboard/nav";
import { SetupChecklist } from "@/components/dashboard/SetupChecklist";
import { getSetupProgress } from "@/lib/onboarding/progress";
import { requireOrgContext } from "../_data";

async function Home({ params }: { params: PageProps<"/[org]">["params"] }) {
  const { org } = await params;
  const ctx = await requireOrgContext(org);
  const progress = await getSetupProgress(ctx); // read after requireOrgContext, inside this Suspense child
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
      <SetupChecklist progress={progress} orgSlug={ctx.org.slug} />
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
