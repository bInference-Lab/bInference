import type { ClientErrorCode } from "@binference/client";
import type { ProtocolErrorCode } from "@binference/protocol";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";

/** The tool a failure belongs to: its name, and whether it proposes with a request id. */
export interface FailedTool {
  readonly name: string;
  readonly takesRequestId: boolean;
}

/** A failed tool call: what the MCP client reads, and the code to log. */
export interface ToolFailure {
  readonly result: CallToolResult;
  readonly code: string;
}

/** An error with a dotted code, such as a `BinferenceError` from the protocol client. */
export interface CodedError {
  readonly code: string;
  readonly message: string;
}

// A BinferenceError from the protocol client: the engine's code from a `fail` or `bye` frame, or
// the client's own. Its message is the engine's English for developers, never a secret.
const codedErrorSchema: z.ZodType<CodedError> = z.object({
  code: z.string().regex(/^[a-z][a-z_]*\.[a-z][a-z_]*$/),
  message: z.string(),
});

// `core.timeout` is the protocol client's own deadline: the engine sent no answer in time.
type KnownCode = ProtocolErrorCode | ClientErrorCode | "core.timeout";

const tokenStep =
  "The engine refused the MCP token. Make a new one with `binference mcp setup --client <client>`, then restart the MCP client.";
const expiredStep =
  "The MCP token expired. Start a new `binference mcp session`, or run `binference mcp setup` for this client again, then restart the MCP client.";
const engineStep =
  "The engine is not reachable. Check it with `binference status`, start it with `binference start`, then try again.";

// The next step for the failures a person can fix; the others carry the engine's message alone.
const nextSteps: Readonly<Partial<Record<KnownCode, string>>> = {
  "auth.required": tokenStep,
  "auth.invalid": tokenStep,
  "auth.expired": expiredStep,
  "auth.revoked": tokenStep,
  "auth.scope":
    "The MCP server holds the read and propose scopes only. The owner confirms, denies and changes settings in Telegram, the console or the CLI.",
  "client.closed": engineStep,
  "client.disconnected": engineStep,
  "core.timeout": engineStep,
  "engine.starting": "The engine is starting. Try again in a few seconds.",
  "engine.stopping": engineStep,
  "protocol.bad_args": "Check the input against the tool's input schema.",
  "protocol.outcome_unknown":
    "The engine that ran the first call with this requestId stopped before it answered, so whether it took effect is unknown. Never send it with a new requestId blindly: list the agent's intents changed since you first sent it with binference_intents, and send it again with a new requestId only if none matches.",
  "order.expiry_limit":
    "The order ends later than the agent's order expiry limit, orderExpiryDays, allows. Name an earlier expiresAt, or leave it out to end the order at the limit; only the owner raises the limit, on the console's Limits screen or with `binference limit set orders.expiryDays=DAYS`.",
};

// A proposal whose answer never came may have run: the same request id answers its first result,
// and a new one could run it twice.
const lostAnswerCodes: ReadonlySet<string> = new Set<KnownCode>([
  "core.timeout",
  "client.disconnected",
  "client.closed",
  "engine.timeout",
]);

const lostAnswerStep =
  "The engine did not answer, so this proposal may have taken effect. Once `binference status` shows the engine running, send it again with the same requestId, which answers the first result and never runs it twice. Without a requestId, list the agent's intents changed since you sent it with binference_intents first, and propose it again only if none matches.";

function isKnownCode(code: string): code is KnownCode {
  return Object.hasOwn(nextSteps, code);
}

function nextStepOf(tool: FailedTool, code: string): string | undefined {
  if (tool.takesRequestId && lostAnswerCodes.has(code)) {
    return lostAnswerStep;
  }
  return isKnownCode(code) ? nextSteps[code] : undefined;
}

function failureText(tool: FailedTool, error: CodedError): string {
  const next = nextStepOf(tool, error.code);
  const text = `${tool.name} failed with ${error.code}: ${error.message}`;
  return next === undefined ? text : `${text} ${next}`;
}

/** The code and message of an error that carries a dotted code; none for any other error. */
export function codedErrorOf(error: unknown): CodedError | undefined {
  const coded = codedErrorSchema.safeParse(error);
  return coded.success ? coded.data : undefined;
}

/**
 * A tool call that failed, as an MCP tool error the model can read and act on: the error's code,
 * its message and, for failures a person can fix, the next step. A proposal whose answer never
 * came is told to send its request id again, never a new one (decision 0437). An error without a
 * code reaches the client as `internal.error`, without its message.
 */
export function toolFailure(tool: FailedTool, error: unknown): ToolFailure {
  const known = codedErrorOf(error) ?? {
    code: "internal.error",
    message: "The MCP server failed to answer this call.",
  };
  return {
    code: known.code,
    result: { isError: true, content: [{ type: "text", text: failureText(tool, known) }] },
  };
}
