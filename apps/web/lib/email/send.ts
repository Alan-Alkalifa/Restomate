import "server-only";
import type { ReactElement } from "react";
import { render } from "@react-email/components";
import { z } from "zod";
import { serverEnv } from "../env.server";
import { getResend } from "./client";

export type SendInput = {
  to: string;
  subject: string;
  react: ReactElement;
  from?: string;
  replyTo?: string;
  idempotencyKey: string;
  tags?: { name: string; value: string }[];
};

export type SendResult = { ok: boolean; id?: string; error?: string };

/** Strip CR/LF (header injection) from a header value. */
function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

const recipientSchema = z.email();

/** `o***@demo.local` */
export function maskEmail(address: string): string {
  const at = address.lastIndexOf("@");
  if (at < 1) return "***";
  return `${address[0]}***${address.slice(at)}`;
}

/**
 * Send an email. Never throws: failures are logged (without the API key or body) and returned as `{ ok: false }`.
 *
 * Callers must run this inside `after()` so the main action never waits on, or fails because of, email.
 * `EMAIL_DELIVERY=log` renders to text and prints it; Resend is never called.
 */
export async function send(input: SendInput): Promise<SendResult> {
  try {
    const subject = oneLine(input.subject);
    const to = oneLine(input.to);
    // Exactly one bare address: rejects lists (comma/semicolon), "Name <addr>" form, empty and malformed values,
    // so a guest-supplied value can never fan out to several recipients.
    if (!recipientSchema.safeParse(to).success || /[,;<>"\s]/.test(to)) {
      console.error(`[email] rejected recipient ${maskEmail(to)}`);
      return { ok: false, error: "invalid recipient" };
    }
    const from = oneLine(input.from ?? serverEnv.EMAIL_FROM);
    const replyTo = input.replyTo ? oneLine(input.replyTo) : undefined;

    if (serverEnv.EMAIL_DELIVERY === "log") {
      const text = await render(input.react, { plainText: true });
      console.log(
        `[email:log] to=${maskEmail(to)} from=${from} subject=${subject} key=${input.idempotencyKey}\n${text}`,
      );
      return { ok: true };
    }

    const { data, error } = await getResend().emails.send(
      {
        from,
        to,
        subject,
        react: input.react,
        ...(replyTo ? { replyTo } : {}),
        ...(input.tags ? { tags: input.tags } : {}),
      },
      { idempotencyKey: input.idempotencyKey },
    );
    if (error) {
      console.error(`[email] send failed (${error.name}): ${error.message}`);
      return { ok: false, error: error.message };
    }
    return { ok: true, id: data?.id };
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown error";
    console.error(`[email] send threw: ${message}`);
    return { ok: false, error: message };
  }
}
