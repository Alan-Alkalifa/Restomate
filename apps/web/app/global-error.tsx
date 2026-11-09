"use client";

import { useEffect } from "react";
import { captureClientException } from "@/lib/posthog/client";

/**
 * Last-resort error page. It replaces the root layout, so it brings its own <html>/<body> and plain styles
 * (Restomate-branded, never tenant-branded). Shows no error details to the user.
 */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    captureClientException(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, sans-serif",
          background: "#fafaf9",
          color: "#1c1917",
        }}
      >
        <main role="alert" style={{ maxWidth: 420, padding: 24, textAlign: "center" }}>
          <p style={{ fontWeight: 700, color: "#0f766e", margin: 0 }}>Restomate</p>
          <h1 style={{ fontSize: 24, margin: "12px 0 8px" }}>Something went wrong</h1>
          <p style={{ margin: "0 0 24px", color: "#57534e" }}>
            An unexpected error occurred. Please try again. If it keeps happening, contact support.
          </p>
          <button
            type="button"
            onClick={() => retry()}
            style={{
              minHeight: 44,
              padding: "0 20px",
              border: 0,
              borderRadius: 8,
              background: "#0f766e",
              color: "#fff",
              fontSize: 16,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
