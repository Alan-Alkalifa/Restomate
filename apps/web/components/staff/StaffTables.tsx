import type { ReactNode } from "react";
import { ActionDialog } from "./ActionDialog";
import { LocationPicker } from "./LocationPicker";
import type { PendingInvitation, StaffAction, StaffData, StaffMember } from "./types";

export type StaffActions = {
  invite: StaffAction;
  resend: StaffAction;
  revoke: StaffAction;
  changeRole: StaffAction;
  setLocations: StaffAction;
  deactivate: StaffAction;
  reactivate: StaffAction;
};

const date = (iso: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(iso));
const th = "px-3 py-2 text-left text-xs font-semibold uppercase text-neutral-600 dark:text-neutral-400";
const td = "px-3 py-2 align-middle text-sm";

function Wrap({ children, caption, min }: { children: ReactNode; caption: string; min: string }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-neutral-300 dark:border-neutral-700">
      <table className={`w-full ${min}`}>
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  );
}

export function roleOptions(data: Pick<StaffData, "roles" | "viewerIsOwner">) {
  // Owner role is only assignable by an owner.
  return data.roles.filter((r) => r.key !== "owner" || data.viewerIsOwner);
}

function locationSummary(m: StaffMember, all: StaffData["locations"]) {
  if (m.allLocations) return "All locations";
  const names = m.locationIds.map((id) => all.find((l) => l.id === id)?.name).filter(Boolean);
  return names.length ? names.join(", ") : "—";
}

export function MembersTable({ data, actions, upgradeHref }: { data: StaffData; actions: StaffActions; upgradeHref: string }) {
  if (data.members.length === 0) return <p role="status" className="rounded-lg border border-dashed border-neutral-400 p-6 text-center">No team members yet.</p>;
  const roles = roleOptions(data);
  return (
    <Wrap caption="Members" min="min-w-[48rem]">
      <thead className="bg-neutral-100 dark:bg-neutral-900">
        <tr>{["Member", "Role", "Locations", "Status", "Actions"].map((h) => <th key={h} scope="col" className={th}>{h}</th>)}</tr>
      </thead>
      <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
        {data.members.map((m) => (
          <tr key={m.memberId}>
            <th scope="row" className={`${td} text-left font-medium`}>
              <span className="break-words">{m.fullName ?? m.email}</span>
              {m.fullName && <span className="block break-all font-normal text-neutral-600 dark:text-neutral-400">{m.email}</span>}
            </th>
            <td className={td}>{m.roleName}</td>
            <td className={td}>{locationSummary(m, data.locations)}</td>
            <td className={td}>{m.status === "active" ? "Active" : <span className="rounded bg-neutral-200 px-2 py-0.5 text-xs text-neutral-900">Deactivated</span>}</td>
            <td className={td}>
              <div className="flex flex-wrap gap-2">
                <ActionDialog label="Role" title={`Change role for ${m.fullName ?? m.email}`} action={actions.changeRole} hidden={{ memberId: m.memberId }} submitLabel="Save role" upgradeHref={upgradeHref}>
                  <label className="flex flex-col gap-1.5 text-sm font-medium">Role
                    <select name="roleId" defaultValue={m.roleId} className="min-h-12 rounded-lg border border-neutral-400 bg-transparent px-2 font-normal">
                      {(roles.some((r) => r.id === m.roleId) ? roles : [...roles, { id: m.roleId, key: m.roleKey, name: m.roleName, isSystem: true }]).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  </label>
                </ActionDialog>
                <ActionDialog label="Locations" title={`Locations for ${m.fullName ?? m.email}`} action={actions.setLocations} hidden={{ memberId: m.memberId }} submitLabel="Save locations">
                  <LocationPicker locations={data.locations} initialAll={m.allLocations} initialIds={m.locationIds} />
                </ActionDialog>
                {m.status === "active" ? (
                  m.isSelf ? null : <ActionDialog label="Deactivate" title={`Deactivate ${m.fullName ?? m.email}?`} description="They will lose access to this restaurant immediately. You can reactivate them later." action={actions.deactivate} hidden={{ memberId: m.memberId }} submitLabel="Deactivate" destructive />
                ) : (
                  <ActionDialog label="Reactivate" title={`Reactivate ${m.fullName ?? m.email}?`} action={actions.reactivate} hidden={{ memberId: m.memberId }} submitLabel="Reactivate" upgradeHref={upgradeHref} />
                )}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </Wrap>
  );
}

export function InvitationsTable({ invitations, actions }: { invitations: PendingInvitation[]; actions: StaffActions }) {
  if (invitations.length === 0) return <p role="status" className="rounded-lg border border-dashed border-neutral-400 p-6 text-center">No pending invitations.</p>;
  return (
    <Wrap caption="Pending invitations" min="min-w-[40rem]">
      <thead className="bg-neutral-100 dark:bg-neutral-900">
        <tr>{["Email", "Role", "Expires", "Actions"].map((h) => <th key={h} scope="col" className={th}>{h}</th>)}</tr>
      </thead>
      <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
        {invitations.map((i) => (
          <tr key={i.id}>
            <th scope="row" className={`${td} break-all text-left font-medium`}>{i.email}</th>
            <td className={td}>{i.roleName}</td>
            <td className={td}>{date(i.expiresAt)} {i.status === "expired" && <span className="ml-1 rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-900">Expired</span>}</td>
            <td className={td}>
              <div className="flex flex-wrap gap-2">
                <ActionDialog label="Resend" title={`Resend invitation to ${i.email}?`} action={actions.resend} hidden={{ invitationId: i.id }} submitLabel="Resend" />
                <ActionDialog label="Revoke" title={`Revoke invitation for ${i.email}?`} description="The invitation link will stop working." action={actions.revoke} hidden={{ invitationId: i.id }} submitLabel="Revoke" destructive />
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </Wrap>
  );
}

export function InviteButton({ data, action, upgradeHref }: { data: StaffData; action: StaffAction; upgradeHref: string }) {
  const roles = roleOptions(data);
  return (
    <ActionDialog label="Invite staff" title="Invite staff" action={action} submitLabel="Send invitation" upgradeHref={upgradeHref}>
      <label className="flex flex-col gap-1.5 text-sm font-medium">Email
        <input name="email" type="email" required autoComplete="off" className="min-h-12 rounded-lg border border-neutral-400 bg-transparent px-3 font-normal" />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">Role
        <select name="roleId" required className="min-h-12 rounded-lg border border-neutral-400 bg-transparent px-2 font-normal">
          {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </label>
      <LocationPicker locations={data.locations} />
    </ActionDialog>
  );
}
