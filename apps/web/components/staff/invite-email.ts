/** Same masking as the get_invitation_preview RPC: first char of local part + "***@" + domain. */
export function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.trim().toLowerCase().split("@");
  return `${local.slice(0, 1)}***@${domain}`;
}

export function emailMatchesHint(email: string, hint: string): boolean {
  return maskEmail(email) === hint.trim().toLowerCase();
}
