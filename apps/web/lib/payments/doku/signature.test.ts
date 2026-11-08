import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { buildComponent, digest, formatTimestamp, sign, signRequest, verifyNotification } from "./signature";

/**
 * Vector computed independently with openssl (NOT DOKU's published example; swap in once
 * developers.doku.com is reachable):
 *   printf %s "$BODY" | openssl dgst -sha256 -binary | base64
 *   printf %s "$COMPONENT" | openssl dgst -sha256 -hmac 'SK-secret' -binary | base64
 */
const BODY = '{"order":{"invoice_number":"INV-1","amount":10000}}';
const DIGEST = "MuGYX8keltOSpUIvsfKJvZ8j+rw195ODU+uGugXN6zA=";
const CLIENT = "MCH-0001-1";
const REQ_ID = "11111111-2222-3333-4444-555555555555";
const TS = "2026-11-08T10:00:00Z";
const SECRET = "SK-secret";
const POST_SIG = "HMACSHA256=Hh5r1v0kLoHwgjvDDofZWjHXtHVDuG83bA7o5eI9N98=";
const GET_SIG = "HMACSHA256=804Z0Y/JqpipCQ4IFBYICG5j6JAbk+wTLezRrfbkwvc=";

describe("digest / component / sign", () => {
  it("digest matches openssl", () => expect(digest(BODY)).toBe(DIGEST));

  it("component has exact lines, no trailing newline", () => {
    expect(
      buildComponent({ clientId: CLIENT, requestId: REQ_ID, requestTimestamp: TS, requestTarget: "/checkout/v1/payment", digest: DIGEST }),
    ).toBe(
      `Client-Id:${CLIENT}\nRequest-Id:${REQ_ID}\nRequest-Timestamp:${TS}\nRequest-Target:/checkout/v1/payment\nDigest:${DIGEST}`,
    );
  });

  it("GET component has no Digest line", () => {
    const c = buildComponent({ clientId: CLIENT, requestId: REQ_ID, requestTimestamp: TS, requestTarget: "/orders/v1/status/INV-1" });
    expect(c).not.toContain("Digest");
    expect(sign(c, SECRET)).toBe(GET_SIG);
  });

  it("signs the POST vector", () => {
    const c = buildComponent({ clientId: CLIENT, requestId: REQ_ID, requestTimestamp: TS, requestTarget: "/checkout/v1/payment", digest: DIGEST });
    expect(sign(c, SECRET)).toBe(POST_SIG);
  });
});

describe("signRequest", () => {
  it("produces headers with a ms-free UTC timestamp", () => {
    const h = signRequest({
      clientId: CLIENT, secretKey: SECRET, requestTarget: "/checkout/v1/payment", body: BODY,
      requestId: REQ_ID, now: new Date("2026-11-08T10:00:00.789Z"),
    });
    expect(h).toEqual({ "Client-Id": CLIENT, "Request-Id": REQ_ID, "Request-Timestamp": TS, Signature: POST_SIG });
  });
  it("GET (no body) signs without Digest", () => {
    const h = signRequest({ clientId: CLIENT, secretKey: SECRET, requestTarget: "/orders/v1/status/INV-1", requestId: REQ_ID, now: new Date(TS) });
    expect(h.Signature).toBe(GET_SIG);
  });
  it("generates a request id when omitted", () => {
    const h = signRequest({ clientId: CLIENT, secretKey: SECRET, requestTarget: "/x" });
    expect(h["Request-Id"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(h["Request-Timestamp"]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });
  it("formatTimestamp drops milliseconds", () => {
    expect(formatTimestamp(new Date("2026-01-02T03:04:05.678Z"))).toBe("2026-01-02T03:04:05Z");
  });
});

describe("verifyNotification", () => {
  const path = "/api/webhooks/doku";
  const headers = signRequest({ clientId: CLIENT, secretKey: SECRET, requestTarget: path, body: BODY, requestId: REQ_ID, now: new Date(TS) });
  const ok = { headers, rawBody: BODY, path, secretKey: SECRET };

  it("accepts a valid notification", () => expect(verifyNotification(ok)).toBe(true));
  it("accepts case-insensitive header names and Headers objects", () => {
    const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    expect(verifyNotification({ ...ok, headers: lower })).toBe(true);
    expect(verifyNotification({ ...ok, headers: new Headers(headers) })).toBe(true);
  });
  it("rejects a one-byte body change", () => expect(verifyNotification({ ...ok, rawBody: BODY.replace("10000", "10001") })).toBe(false));
  it("rejects a wrong secret", () => expect(verifyNotification({ ...ok, secretKey: "other" })).toBe(false));
  it("rejects a wrong path (including a query string)", () => {
    expect(verifyNotification({ ...ok, path: "/api/webhooks/other" })).toBe(false);
    expect(verifyNotification({ ...ok, path: `${path}?x=1` })).toBe(false);
  });
  it.each(["Client-Id", "Request-Id", "Request-Timestamp", "Signature"])("rejects missing %s", (name) => {
    const h: Record<string, string> = { ...headers };
    delete h[name];
    expect(verifyNotification({ ...ok, headers: h })).toBe(false);
  });
  it("rejects different-length and garbage signatures without throwing", () => {
    expect(verifyNotification({ ...ok, headers: { ...headers, Signature: "HMACSHA256=short" } })).toBe(false);
    expect(verifyNotification({ ...ok, headers: { ...headers, Signature: "" } })).toBe(false);
    expect(verifyNotification({ ...ok, headers: { ...headers, Signature: "é".repeat(50) } })).toBe(false);
  });
  it("rejects a tampered timestamp or client id", () => {
    expect(verifyNotification({ ...ok, headers: { ...headers, "Request-Timestamp": "2026-11-08T10:00:01Z" } })).toBe(false);
    expect(verifyNotification({ ...ok, headers: { ...headers, "Client-Id": "MCH-9" } })).toBe(false);
  });
});
