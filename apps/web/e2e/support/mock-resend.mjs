/**
 * Minimal Resend stand-in for e2e (the app points the Resend SDK here via RESEND_BASE_URL).
 * POST /emails            -> stores the message, answers { id }
 * GET  /__mails?to=addr   -> JSON array of stored messages to that address (newest last)
 * GET  /health            -> 200
 * Everything else is treated as a PostHog stand-in (NEXT_PUBLIC_POSTHOG_HOST points here in e2e):
 * POST anything else      -> recorded, answers { status: 1 };  GET /__ph -> recorded captures (url, contentType, body base64)
 * Local test tool only: it never forwards anything.
 */
import http from "node:http";

const mails = [];
const captures = [];
const port = Number(process.env.MOCK_RESEND_PORT ?? 4010);

http
  .createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    if (req.method === "GET" && url.pathname === "/health") return void res.writeHead(200).end("ok");
    if (req.method === "GET" && url.pathname === "/__mails") {
      const to = (url.searchParams.get("to") ?? "").toLowerCase();
      const found = mails.filter((m) => [].concat(m.to).some((t) => String(t).toLowerCase().includes(to)));
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(found));
      return;
    }
    if (req.method === "GET" && url.pathname === "/__ph") {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(captures));
      return;
    }
    if (req.method === "POST" && url.pathname !== "/emails") {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        captures.push({ url: req.url, contentType: req.headers["content-type"] ?? "", bodyBase64: Buffer.concat(chunks).toString("base64") });
        res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" }).end('{"status":1}');
      });
      return;
    }
    if (req.method === "OPTIONS") return void res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" }).end();
    if (req.method === "POST" && url.pathname === "/emails") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        try {
          const parsed = JSON.parse(body);
          mails.push({ ...parsed, idempotencyKey: req.headers["idempotency-key"] ?? null, receivedAt: Date.now() });
          res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ id: `mock_${mails.length}` }));
        } catch {
          res.writeHead(400).end("bad json");
        }
      });
      return;
    }
    res.writeHead(404).end("not found");
  })
  .listen(port, "127.0.0.1", () => console.log(`[mock-resend] listening on ${port}`));
