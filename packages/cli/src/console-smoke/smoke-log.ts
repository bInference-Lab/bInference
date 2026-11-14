import { join } from "node:path";
import type { EngineHandlerTable } from "@binference/engine/surfaces";
import { writePrivateFile } from "@binference/platform";
import { createTempFolder } from "@binference/platform/testing";
import { createLogOperations } from "../compose/log-operations.js";
import { noPermissions } from "../e2e/test-host.js";

// The smoke engine's log: a file of an info line, a warning that names a host, an error and a line
// of free text, which `log/recent` reads as the self-hosted engine reads its own log.

const lines = [
  { level: "info", subsystem: "engine.server", event: "server.listening" },
  {
    level: "warn",
    subsystem: "engine.orders",
    event: "order.skipped",
    fields: { reason: "late", host: "rpc.example.com" },
  },
  {
    level: "error",
    subsystem: "engine.chain",
    event: "rpc.failed",
    fields: { errorCode: "chain.rpc_unreachable" },
  },
];

function logText(): string {
  const written = lines.map((line, at) => {
    const time = new Date(Date.UTC(2026, 10, 14, 8, 0, at)).toISOString();
    return JSON.stringify({ time, ...line });
  });
  return `${[...written, "free text the log's rules never show"].join("\n")}\n`;
}

/** The smoke's `log/recent` handler, and how to remove its log. */
export interface SmokeLog {
  readonly handlers: EngineHandlerTable;
  close(): Promise<void>;
}

/** Writes the smoke's log file and answers `log/recent` over it. */
export async function startSmokeLog(): Promise<SmokeLog> {
  const folder = await createTempFolder("bnf-smoke-log-");
  const file = join(folder.path, "engine.log");
  const options = { permissions: noPermissions, signal: AbortSignal.timeout(10_000) };
  await writePrivateFile(file, logText(), options);
  return { handlers: createLogOperations({ file }), close: async () => folder.remove() };
}
