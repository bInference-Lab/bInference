import type { ClientErrorCode } from "@binference/client";
import type { ProtocolErrorCode } from "@binference/protocol";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";

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
  "The engine refused the MCP token. Create a new one with `binference token create --for mcp`, then restart the MCP client.";
const engineStep =
  "The engine is not reachable. Check it with `binference status`, start it with `binference start`, then try again.";

// The next step for the failures a person can fix; the others carry the engine's message alone.
const nextSteps: Readonly<Partial<Record<KnownCode, string>>> = {
  "auth.required": tokenStep,
  "auth.invalid": tokenStep,
  "auth.expired": tokenStep,
  "auth.revoked": tokenStep,
  "auth.scope":
    "The MCP server holds the read and propose scopes only. The owner confirms, denies and changes settings in Telegram, the console or the CLI.",
  "client.closed": engineStep,
  "client.disconnected": engineStep,
  "core.timeout": engineStep,
  "engine.starting": "The engine is starting. Try again in a few seconds.",
  "engine.stopping": engineStep,
  "protocol.bad_args": "Check the input against the tool's input schema.",
};

function isKnownCode(code: string): code is KnownCode {
  return Object.hasOwn(nextSteps, code);
}

function failureText(tool: string, error: CodedError): string {
  const next = isKnownCode(error.code) ? nextSteps[error.code] : undefined;
  const text = `${tool} failed with ${error.code}: ${error.message}`;
  return next === undefined ? text : `${text} ${next}`;
}

/** The code and message of an error that carries a dotted code; none for any other error. */
export function codedErrorOf(error: unknown): CodedError | undefined {
  const coded = codedErrorSchema.safeParse(error);
  return coded.success ? coded.data : undefined;
}

/**
 * A tool call that failed, as an MCP tool error the model can read and act on: the error's code,
 * its message and, for failures a person can fix, the next step. An error without a code reaches
 * the client as `internal.error`, without its message.
 */
export function toolFailure(tool: string, error: unknown): ToolFailure {
  const known = codedErrorOf(error) ?? {
    code: "internal.error",
    message: "The MCP server failed to answer this call.",
  };
  return {
    code: known.code,
    result: { isError: true, content: [{ type: "text", text: failureText(tool, known) }] },
  };
}
