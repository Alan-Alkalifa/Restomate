import { SeverityNumber } from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor, LoggerProvider } from "@opentelemetry/sdk-logs";

const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const posthogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST;
const missingVariable = posthogKey ? "NEXT_PUBLIC_POSTHOG_HOST" : "NEXT_PUBLIC_POSTHOG_KEY";

const posthogLoggerProvider =
  posthogKey && posthogHost
    ? new LoggerProvider({
        resource: resourceFromAttributes({
          "service.name": "restomate-web",
          "deployment.environment": process.env.NODE_ENV ?? "development",
        }),
        processors: [
          new BatchLogRecordProcessor({
            exporter: new OTLPLogExporter({
              url: new URL("/i/v1/logs", posthogHost).toString(),
              headers: {
                Authorization: `Bearer ${posthogKey}`,
                "Content-Type": "application/json",
              },
            }),
          }),
        ],
      })
    : undefined;

const posthogLogger = posthogLoggerProvider?.getLogger("restomate.posthog-logs");

export function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  if (!posthogLogger) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        `${missingVariable} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${missingVariable} is configured`,
      );
    }
    return;
  }

  posthogLogger.emit({
    body: "PostHog log capture initialized",
    severityNumber: SeverityNumber.INFO,
    attributes: { event: "posthog_log_capture_initialized" },
  });
}
