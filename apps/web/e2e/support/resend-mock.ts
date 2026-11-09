/** Reads what the app "sent" through the Resend SDK (captured by support/mock-resend.mjs). */
const BASE = process.env.MOCK_RESEND_URL ?? "http://127.0.0.1:4010";

export type SentMail = { to: string | string[]; from: string; subject: string; html?: string; text?: string; idempotencyKey: string | null; reply_to?: string };

export async function waitForSentMail(to: string, opts: { timeoutMs?: number; count?: number } = {}): Promise<SentMail[]> {
  const { timeoutMs = 30_000, count = 1 } = opts;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await fetch(`${BASE}/__mails?to=${encodeURIComponent(to)}`);
    const mails = (await res.json()) as SentMail[];
    if (mails.length >= count) return mails;
    if (Date.now() > deadline) throw new Error(`No Resend mail to ${to} within ${timeoutMs}ms (got ${mails.length}, wanted ${count})`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

/** The /invite/{token} URL inside a staff invitation mail. */
export function inviteUrlOf(mail: SentMail): string {
  const m = (mail.html ?? "").concat("\n", mail.text ?? "").match(/https?:\/\/[^\s"'<>)]+\/invite\/[A-Za-z0-9_-]+/);
  if (!m) throw new Error("No /invite/ link in the mail");
  return m[0].replace(/&amp;/g, "&");
}
