import { once } from "node:events";
// oxlint-disable-next-line eslint/no-restricted-imports -- a stand-in model provider on the loopback for the smoke: no outbound request
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { text as readBody } from "node:stream/consumers";
import type { JsonValue } from "@binference/core";
import { z } from "zod";
import { headersOf } from "../e2e/incoming-headers.js";
import { createFakeModelProvider } from "../e2e/model-fixtures.js";

/** One tool call the scripted model makes: the tool's name and its arguments. */
export interface SmokeToolCall {
  readonly name: string;
  readonly args: Readonly<Record<string, JsonValue>>;
}

/** The smoke's model provider on the loopback, which speaks Chat Completions. */
export interface SmokeModel {
  /** Its address with the API's version, such as `http://127.0.0.1:4000/v1`. */
  readonly baseUrl: string;
  close(): Promise<void>;
}

const streamSchema = z.looseObject({ stream: z.boolean().optional() });

// One server-sent event of a streamed Chat Completions answer.
function event(delta: object, finish: string | null = null): string {
  const chunk = {
    id: "chatcmpl-smoke",
    object: "chat.completion.chunk",
    created: 1_760_000_000,
    model: "test-model",
    choices: [{ index: 0, delta, finish_reason: finish }],
  };
  return `data: ${JSON.stringify(chunk)}\n\n`;
}

function usageEvent(): string {
  const usage = { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 };
  const chunk = { id: "chatcmpl-smoke", object: "chat.completion.chunk", choices: [], usage };
  return `data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`;
}

function callEvents(call: SmokeToolCall): readonly string[] {
  const named = { index: 0, id: "call_smoke", type: "function" };
  const fn = { name: call.name, arguments: JSON.stringify(call.args) };
  return [
    event({ role: "assistant", content: "" }),
    event({ tool_calls: [{ ...named, function: fn }] }),
    event({}, "tool_calls"),
  ];
}

function textEvents(text: string): readonly string[] {
  return [event({ role: "assistant", content: "" }), event({ content: text }), event({}, "stop")];
}

function stream(response: ServerResponse, events: readonly string[]): void {
  response.writeHead(200, { "content-type": "text/event-stream" });
  events.forEach((text) => response.write(text));
  response.end(usageEvent());
}

/**
 * Starts the smoke's model provider on `127.0.0.1`. A call that does not stream, as init's checks
 * are, gets the e2e fake provider's answer, which takes its test key and model. The agent's turns
 * stream: the first makes the tool call, every later one answers the report text.
 */
export async function startSmokeModel(script: {
  readonly call: SmokeToolCall;
  readonly report: string;
}): Promise<SmokeModel> {
  const fake = createFakeModelProvider();
  const seen = { turns: 0 };
  const answer = async (incoming: IncomingMessage, response: ServerResponse): Promise<void> => {
    const body = await readBody(incoming);
    if (streamSchema.parse(JSON.parse(body)).stream === true) {
      seen.turns += 1;
      stream(response, seen.turns === 1 ? callEvents(script.call) : textEvents(script.report));
      return;
    }
    const url = `http://127.0.0.1${incoming.url ?? "/"}`;
    const headers = headersOf(incoming);
    const signal = AbortSignal.timeout(10_000);
    const reply = await fake.http.request({ method: "POST", url, headers, body, signal });
    response.writeHead(reply.status, reply.headers).end(reply.body);
  };
  const server = createServer((incoming, response) => {
    answer(incoming, response).catch(() => {
      response.writeHead(500).end();
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  return {
    baseUrl: `http://127.0.0.1:${String(port)}/v1`,
    close: async () => {
      server.closeAllConnections();
      await once(server.close(), "close");
    },
  };
}
