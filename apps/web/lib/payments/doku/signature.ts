import "server-only";

import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

/**
 * DOKU Non-SNAP signing (CLAUDE.md "DOKU request signing").
 *   Digest    = base64(sha256(rawBody))                      (omitted when there is no body)
 *   Component = "Client-Id:{id}\nRequest-Id:{uuid}\nRequest-Timestamp:{ISO8601 UTC}\n
 *                Request-Target:{path}\nDigest:{digest}"      (no trailing newline)
 *   Signature = "HMACSHA256=" + base64(hmacSha256(Component, secretKey))
 * Secrets and full headers are never logged here.
 */

export type ComponentInput = {
  clientId: string;
  requestId: string;
  requestTimestamp: string;
  requestTarget: string;
  digest?: string;
};

export function digest(rawBody: string): string {
  return createHash("sha256").update(rawBody, "utf8").digest("base64");
}

export function buildComponent(input: ComponentInput): string {
  const lines = [
    `Client-Id:${input.clientId}`,
    `Request-Id:${input.requestId}`,
    `Request-Timestamp:${input.requestTimestamp}`,
    `Request-Target:${input.requestTarget}`,
  ];
  if (input.digest) lines.push(`Digest:${input.digest}`);
  return lines.join("\n");
}

export function sign(component: string, secretKey: string): string {
  return "HMACSHA256=" + createHmac("sha256", secretKey).update(component, "utf8").digest("base64");
}

/** ISO 8601 UTC without milliseconds, e.g. 2026-11-08T10:00:00Z. */
export function formatTimestamp(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export type SignedHeaders = {
  "Client-Id": string;
  "Request-Id": string;
  "Request-Timestamp": string;
  Signature: string;
};

export function signRequest(args: {
  clientId: string;
  secretKey: string;
  requestTarget: string;
  /** Raw JSON body exactly as it will be sent. Omit for GET. */
  body?: string;
  requestId?: string;
  now?: Date;
}): SignedHeaders {
  const requestId = args.requestId ?? randomUUID();
  const requestTimestamp = formatTimestamp(args.now ?? new Date());
  const component = buildComponent({
    clientId: args.clientId,
    requestId,
    requestTimestamp,
    requestTarget: args.requestTarget,
    digest: args.body ? digest(args.body) : undefined,
  });
  return {
    "Client-Id": args.clientId,
    "Request-Id": requestId,
    "Request-Timestamp": requestTimestamp,
    Signature: sign(component, args.secretKey),
  };
}

type HeaderBag = Headers | Record<string, string | string[] | undefined>;

function getHeader(headers: HeaderBag, name: string): string | undefined {
  if (typeof Headers !== "undefined" && headers instanceof Headers) return headers.get(name) ?? undefined;
  const wanted = name.toLowerCase();
  for (const [k, v] of Object.entries(headers as Record<string, string | string[] | undefined>)) {
    if (k.toLowerCase() === wanted) return Array.isArray(v) ? v[0] : v;
  }
  return undefined;
}

/**
 * Verifies an incoming DOKU notification. `path` is OUR notification path
 * (e.g. /api/webhooks/doku). Returns false (never throws) on any mismatch.
 */
export function verifyNotification(args: {
  headers: HeaderBag;
  rawBody: string;
  path: string;
  secretKey: string;
}): boolean {
  try {
    const clientId = getHeader(args.headers, "Client-Id");
    const requestId = getHeader(args.headers, "Request-Id");
    const requestTimestamp = getHeader(args.headers, "Request-Timestamp");
    const received = getHeader(args.headers, "Signature");
    if (!clientId || !requestId || !requestTimestamp || !received) return false;

    const expected = sign(
      buildComponent({
        clientId,
        requestId,
        requestTimestamp,
        requestTarget: args.path,
        digest: args.rawBody ? digest(args.rawBody) : undefined,
      }),
      args.secretKey,
    );
    const a = Buffer.from(received, "utf8");
    const b = Buffer.from(expected, "utf8");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
