import { Suspense } from "react";
import { connection } from "next/server";
import { ForbiddenNotice } from "@/components/dashboard/notices";
import { InvitationsTable, InviteButton, MembersTable, type StaffActions } from "@/components/staff/StaffTables";
import { requireOrgContext, requirePermission } from "../../_data";
import { listStaff } from "@/lib/staff/data";
import * as staff from "@/lib/staff/actions";

async function Staff({ params }: { params: PageProps<"/[org]/staff">["params"] }) {
  await connection(); // session checks read the clock: request time only, never the prerender
  const { org } = await params;
  const ctx = await requireOrgContext(org);
  if (!ctx.permissions.includes("staff.manage")) return <ForbiddenNotice />;
  await requirePermission(ctx.org.id, "staff.manage");
  const data = await listStaff(ctx.org.slug);
  const slug = ctx.org.slug;
  // Server actions bound to the org slug (the client never supplies the org).
  const actions: StaffActions = {
    invite: staff.inviteStaff.bind(null, slug),
    resend: staff.resendInvitation.bind(null, slug),
    revoke: staff.revokeInvitation.bind(null, slug),
    changeRole: staff.changeMemberRole.bind(null, slug),
    setLocations: staff.setMemberLocations.bind(null, slug),
    deactivate: staff.deactivateMember.bind(null, slug),
    reactivate: staff.reactivateMember.bind(null, slug),
  };
  const upgradeHref = `/${slug}/settings`;
  return (
    <main className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Staff</h1>
        <InviteButton data={data} action={actions.invite} upgradeHref={upgradeHref} />
      </div>
      <section aria-labelledby="members" className="flex flex-col gap-3">
        <h2 id="members" className="text-lg font-semibold">Members</h2>
        <MembersTable data={data} actions={actions} upgradeHref={upgradeHref} />
      </section>
      <section aria-labelledby="pending" className="flex flex-col gap-3">
        <h2 id="pending" className="text-lg font-semibold">Pending invitations</h2>
        <InvitationsTable invitations={data.invitations} actions={actions} />
      </section>
    </main>
  );
}

export default function StaffPage({ params }: PageProps<"/[org]/staff">) {
  return (
    <Suspense fallback={<div role="status" aria-label="Loading" className="h-64 animate-pulse rounded-xl bg-neutral-200 dark:bg-neutral-800" />}>
      <Staff params={params} />
    </Suspense>
  );
}
