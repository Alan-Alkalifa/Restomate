/**
 * Mailpit helper (local Supabase mail catcher, REST API on :54324).
 * Polls with a deadline instead of sleeping, so tests are fast when mail is fast and
 * only fail on a real timeout.
 */
const MAILPIT = process.env.MAILPIT_URL ?? "http://localhost:54324";

type Summary = { ID: string; Subject: string; Created: string; To: { Address: string }[] };

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${MAILPIT}${path}`);
  if (!res.ok) throw new Error(`Mailpit ${path} -> ${res.status}`);
  return (await res.json()) as T;
}

/** Newest message to `address` (optionally after `since`, and matching `subject`). Polls until `timeoutMs`. */
export async function waitForEmail(
  address: string,
  opts: { subject?: RegExp; since?: Date; timeoutMs?: number } = {},
): Promise<{ id: string; subject: string; html: string; text: string }> {
  const { subject, since, timeoutMs = 20_000 } = opts;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = await getJson<{ messages: Summary[] }>(
      `/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}&limit=20`,
    );
    const match = found.messages
      .filter((m) => (!subject || subject.test(m.Subject)) && (!since || new Date(m.Created) >= since))
      .sort((a, b) => b.Created.localeCompare(a.Created))[0];
    if (match) {
      const full = await getJson<{ HTML: string; Text: string; Subject: string }>(`/api/v1/message/${match.ID}`);
      return { id: match.ID, subject: full.Subject, html: full.HTML, text: full.Text };
    }
    if (Date.now() > deadline) throw new Error(`No email to ${address} within ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

/** First http(s) link in the mail that matches `pattern` (HTML entities decoded). */
export function extractLink(mail: { html: string; text: string }, pattern: RegExp = /token_hash=|\/auth\/v1\/verify|\/auth\/confirm/): string {
  const urls = [...(mail.html + "\n" + mail.text).matchAll(/https?:\/\/[^\s"'<>)]+/g)].map((m) => m[0].replace(/&amp;/g, "&"));
  const link = urls.find((u) => pattern.test(u));
  if (!link) throw new Error("No matching link in email");
  return link;
}

export async function deleteMessagesTo(address: string): Promise<void> {
  const found = await getJson<{ messages: Summary[] }>(`/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`);
  if (!found.messages.length) return;
  await fetch(`${MAILPIT}/api/v1/messages`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ IDs: found.messages.map((m) => m.ID) }),
  });
}
