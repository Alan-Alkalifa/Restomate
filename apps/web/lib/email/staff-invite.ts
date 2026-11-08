import "server-only";
import { createElement } from "react";
import StaffInvite, { type StaffInviteProps } from "../../emails/StaffInvite";
import { serverEnv } from "../env.server";
import { send, type SendResult } from "./send";

export const GUEST_FROM_ADDRESS = "orders@mail.restomate.app";

/** Remove characters that could break out of a display name or inject headers. */
export function sanitizeDisplayName(name: string): string {
  const cleaned = name
    .replace(/[\r\n\u2028\u2029"<>\\]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return cleaned || "Restomate";
}

export function buildSender(restaurantName: string): string {
  return `"${sanitizeDisplayName(restaurantName)} via Restomate" <${GUEST_FROM_ADDRESS}>`;
}

function safeAcceptUrl(url: string): string | null {
  const prefix = `${serverEnv.NEXT_PUBLIC_APP_URL.replace(/\/+$/, "")}/invite/`;
  return url.startsWith(prefix) ? url : null;
}

function safeLogoUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

export type SendStaffInviteInput = {
  organizationId: string;
  invitationId: string;
  sendCount: number;
  to: string;
  /** `props.timeZone` must be the organization's timezone. */
  props: StaffInviteProps;
  replyTo?: string | null;
};

/**
 * Send a staff invitation. Never throws.
 * Call from `after()` so the invite action never waits on, or fails because of, email.
 */
export async function sendStaffInvite(input: SendStaffInviteInput): Promise<SendResult> {
  const acceptUrl = safeAcceptUrl(input.props.acceptUrl);
  if (!acceptUrl) {
    console.error(`[email] staff invite ${input.invitationId}: acceptUrl rejected`);
    return { ok: false, error: "invalid acceptUrl" };
  }
  const props: StaffInviteProps = {
    ...input.props,
    acceptUrl,
    logoUrl: safeLogoUrl(input.props.logoUrl),
  };
  return send({
    to: input.to,
    subject: `You're invited to join ${sanitizeDisplayName(props.restaurantName)} on Restomate`,
    react: createElement(StaffInvite, props),
    from: buildSender(props.restaurantName),
    replyTo: input.replyTo ?? undefined,
    idempotencyKey: `staff-invite/${input.invitationId}/${input.sendCount}`,
    tags: [
      { name: "type", value: "staff_invite" },
      { name: "organization_id", value: input.organizationId },
    ],
  });
}
