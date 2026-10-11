import process from "node:process";
import { createMemoryLogger } from "@binference/core/testing";
import { serveMcpOverStdio } from "@binference/mcp";
import { writePrivateFile } from "@binference/platform";
import { noPermissions } from "../e2e/test-host.js";
import { createMcpRecorder, type RecordedCall } from "./mcp-recorder.js";
import { startSkillRunEngine } from "./skill-run-engine.js";
import { skillRunEnvSchema } from "./skill-run-env.schema.js";
import { skillRunVerdict } from "./skill-run-verdict.js";

// The MCP server of the recorded run, which the MCP client starts as `binference mcp` would be:
// the run's engine in this process, served over stdin and stdout with a recorder between them.
// After each tool call and each answer it rewrites the record file: the run's ids, every call and
// the verdict so far. Like `main.ts`, it alone reads `process`, and nothing else writes to stdout.
const env = skillRunEnvSchema.parse(process.env);
const engine = await startSkillRunEngine();
const stop = new AbortController();
process.once("SIGTERM", () => stop.abort());
process.once("SIGINT", () => stop.abort());

let written: Promise<void> = Promise.resolve();
function record(calls: readonly RecordedCall[]): void {
  const verdict = skillRunVerdict(calls, engine.ids);
  const text = `${JSON.stringify({ ids: engine.ids, calls, verdict }, null, 2)}\n`;
  const files = { permissions: noPermissions, signal: AbortSignal.timeout(5_000) };
  // Writes run one after another, so the file always ends with the latest calls.
  written = written.then(async () => writePrivateFile(env.SKILL_RUN_RECORD, text, files));
}

record([]);
const recorder = createMcpRecorder({ input: process.stdin, output: process.stdout }, record);
const logger = createMemoryLogger({ subsystem: "mcp" });
await serveMcpOverStdio(
  { client: engine.mcpClient, version: "skill-run", logger, streams: recorder.streams },
  stop.signal,
);
await written;
await engine.close();
