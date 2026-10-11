import { Transform } from "node:stream";
import type { JsonValue } from "@binference/core";
import type { McpStreams } from "@binference/mcp";
import type { z } from "zod";
import { answerLineSchema, type RpcId, toolCallLineSchema } from "./mcp-line.schema.js";

/** A tool's answer as the MCP client read it: whether it was an error, and its text blocks. */
interface RecordedAnswer {
  readonly isError: boolean;
  readonly texts: readonly string[];
}

/** One tool call the MCP client made, with the server's answer once it came. */
export interface RecordedCall {
  readonly tool: string;
  readonly arguments: { readonly [key: string]: JsonValue };
  readonly answer?: RecordedAnswer;
}

/** The MCP server's streams with a recorder between them and the MCP client. */
export interface McpRecorder {
  /** The streams to serve MCP over: they pass every byte through unchanged. */
  readonly streams: McpStreams;
  /** Every tool call so far, in the order the client made them. */
  calls(): readonly RecordedCall[];
}

function parsedLine<T>(schema: z.ZodType<T>, line: string): T | undefined {
  try {
    const parsed = schema.safeParse(JSON.parse(line));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

// A stream that passes its bytes through and hands each whole line it carries to `onLine`. MCP's
// stdio transport writes one JSON-RPC message per line.
function lineTap(onLine: (line: string) => void): Transform {
  const decoder = new TextDecoder();
  let rest = "";
  return new Transform({
    transform(chunk: Uint8Array, _encoding, done) {
      const lines = (rest + decoder.decode(chunk, { stream: true })).split("\n");
      rest = lines.pop() ?? "";
      lines.forEach(onLine);
      done(null, chunk);
    },
  });
}

function answerOf(line: string): readonly [RpcId, RecordedAnswer] | undefined {
  const answer = parsedLine(answerLineSchema, line);
  if (answer === undefined) {
    return undefined;
  }
  const blocks = answer.result?.content ?? [];
  const texts = blocks.flatMap((block) => (block.text === undefined ? [] : [block.text]));
  const isError = answer.error !== undefined || answer.result?.isError === true;
  return [
    answer.id,
    { isError, texts: answer.error === undefined ? texts : [answer.error.message] },
  ];
}

/**
 * Records the tool calls an MCP client makes and the answers it gets, by reading the JSON-RPC
 * lines that pass between the client's streams and the server. `onChange` gets every call so far
 * after each request and each answer, so a run that ends abruptly still leaves its record.
 */
export function createMcpRecorder(
  client: McpStreams,
  onChange: (calls: readonly RecordedCall[]) => void,
): McpRecorder {
  const calls: RecordedCall[] = [];
  const pending = new Map<RpcId, number>();
  const input = lineTap((line) => {
    const request = parsedLine(toolCallLineSchema, line);
    if (request !== undefined) {
      pending.set(request.id, calls.length);
      calls.push({ tool: request.params.name, arguments: request.params.arguments ?? {} });
      onChange([...calls]);
    }
  });
  const output = lineTap((line) => {
    const answered = answerOf(line);
    const index = answered === undefined ? undefined : pending.get(answered[0]);
    const call = index === undefined ? undefined : calls[index];
    if (answered !== undefined && index !== undefined && call !== undefined) {
      pending.delete(answered[0]);
      calls[index] = { ...call, answer: answered[1] };
      onChange([...calls]);
    }
  });
  client.input.pipe(input);
  output.pipe(client.output);
  return { streams: { input, output }, calls: () => [...calls] };
}
