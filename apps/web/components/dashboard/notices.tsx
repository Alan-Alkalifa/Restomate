import Link from "next/link";

function Notice({ title, children, role = "status" }: { title: string; children?: React.ReactNode; role?: "status" | "alert" }) {
  return (
    <main role={role} className="mx-auto flex min-h-[50vh] max-w-md flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-2xl font-semibold">{title}</h1>
      {children}
    </main>
  );
}

export const NotFoundNotice = () => <Notice title="Page not found"><p className="text-sm">This page doesn&apos;t exist.</p></Notice>;

/** Rendered by pages when requirePermission denies (HTTP status stays 200 inside Suspense; see PR notes). */
export const ForbiddenNotice = () => (
  <Notice title="You don't have access" role="alert">
    <p className="text-sm">Ask a restaurant owner or manager to update your role.</p>
  </Notice>
);

export const SuspendedNotice = () => (
  <Notice title="This restaurant account is suspended" role="alert">
    <p className="text-sm">Please contact Restomate support.</p>
    <meta name="robots" content="noindex" />
  </Notice>
);

export const UpgradeNotice = ({ feature, orgSlug }: { feature: string; orgSlug: string }) => (
  <Notice title="Upgrade to unlock this feature">
    <p className="text-sm">Your current plan doesn&apos;t include {feature.replace(/_/g, " ")}.</p>
    <Link href={`/${orgSlug}/settings`} className="flex min-h-12 items-center rounded-lg bg-teal-700 px-5 font-semibold text-white">View plans</Link>
  </Notice>
);
