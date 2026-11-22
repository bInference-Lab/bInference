// Runs the Next.js command line with its telemetry off, the same way on every OS.
process.env.NEXT_TELEMETRY_DISABLED = "1";
await import("next/dist/bin/next");
