import type { RecordedAnswer } from "./recorded-http.js";

// Messages answers written by hand in the shapes Anthropic's streaming docs give for each event
// (`message_start`, `content_block_start`, `ping`, `content_block_delta` with `text_delta`,
// `input_json_delta`, `thinking_delta` and `signature_delta`, `content_block_stop`,
// `message_delta`, `message_stop`, `error`) and its errors docs give for an error answer
// (`{ "type": "error", "error": { "type", "message" }, "request_id" }`).

const sse = { "content-type": "text/event-stream" };
const json = { "content-type": "application/json" };

// Each pair is one server-sent event: its name and its data.
const events = (pairs: readonly (readonly [string, string])[]): readonly string[] =>
  pairs.map(([name, data]) => `event: ${name}\ndata: ${data}\n\n`);

const start = (id: string, usage: string): readonly [string, string] => [
  "message_start",
  `{"type":"message_start","message":{"id":"${id}","type":"message","role":"assistant","content":[],"model":"claude-sonnet-5-5","stop_reason":null,"stop_sequence":null,"usage":${usage}}}`,
];

const stop: readonly [string, string] = ["message_stop", '{"type":"message_stop"}'];
const ping: readonly [string, string] = ["ping", '{"type": "ping"}'];

/** A text answer that ends on its own, its usage read from the cache. */
export const messagesTextStream: RecordedAnswer = {
  status: 200,
  headers: sse,
  chunks: events([
    start(
      "msg_01T",
      '{"input_tokens":12,"cache_creation_input_tokens":0,"cache_read_input_tokens":800,"output_tokens":1,"service_tier":"standard"}',
    ),
    [
      "content_block_start",
      '{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
    ],
    ping,
    [
      "content_block_delta",
      '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"BNB is"}}',
    ],
    [
      "content_block_delta",
      '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" up 2% today."}}',
    ],
    ["content_block_stop", '{"type":"content_block_stop","index":0}'],
    [
      "message_delta",
      '{"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":9}}',
    ],
    stop,
  ]),
};

/** Text, then two tool calls, the first one's input in pieces, then `tool_use`. */
export const messagesToolUseStream: RecordedAnswer = {
  status: 200,
  headers: sse,
  chunks: events([
    start(
      "msg_02U",
      '{"input_tokens":1200,"cache_creation_input_tokens":2048,"cache_read_input_tokens":0,"output_tokens":2}',
    ),
    [
      "content_block_start",
      '{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
    ],
    [
      "content_block_delta",
      '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Let me check."}}',
    ],
    ["content_block_stop", '{"type":"content_block_stop","index":0}'],
    [
      "content_block_start",
      '{"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_01A","name":"token_info","input":{}}}',
    ],
    [
      "content_block_delta",
      '{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":""}}',
    ],
    [
      "content_block_delta",
      '{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"sym"}}',
    ],
    [
      "content_block_delta",
      '{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"bol\\":\\"CAKE\\"}"}}',
    ],
    ["content_block_stop", '{"type":"content_block_stop","index":1}'],
    [
      "content_block_start",
      '{"type":"content_block_start","index":2,"content_block":{"type":"tool_use","id":"toolu_01B","name":"portfolio","input":{}}}',
    ],
    ["content_block_stop", '{"type":"content_block_stop","index":2}'],
    [
      "message_delta",
      '{"type":"message_delta","delta":{"stop_reason":"tool_use","stop_sequence":null},"usage":{"output_tokens":41}}',
    ],
    stop,
  ]),
};

/** A model that thinks, its thinking signed, then calls a tool and thinks again before the next. */
export const messagesThinkingStream: RecordedAnswer = {
  status: 200,
  headers: sse,
  chunks: events([
    start("msg_03V", '{"input_tokens":300,"output_tokens":1}'),
    [
      "content_block_start",
      '{"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"","signature":""}}',
    ],
    [
      "content_block_delta",
      '{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"The owner asks for a quote."}}',
    ],
    [
      "content_block_delta",
      '{"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"EqQBCgIYAhIM1gbcDa9GJwZA"}}',
    ],
    ["content_block_stop", '{"type":"content_block_stop","index":0}'],
    [
      "content_block_start",
      '{"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_03A","name":"quote","input":{}}}',
    ],
    [
      "content_block_delta",
      '{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"amount\\":\\"1\\"}"}}',
    ],
    ["content_block_stop", '{"type":"content_block_stop","index":1}'],
    [
      "content_block_start",
      '{"type":"content_block_start","index":2,"content_block":{"type":"redacted_thinking","data":"EmwKAhgBEgy3va3pzix"}}',
    ],
    ["content_block_stop", '{"type":"content_block_stop","index":2}'],
    [
      "message_delta",
      '{"type":"message_delta","delta":{"stop_reason":"tool_use","stop_sequence":null},"usage":{"output_tokens":120}}',
    ],
    stop,
  ]),
};

/** A compatible server's tool call whose whole input comes with its start, in no piece after. */
export const messagesWholeInputStream: RecordedAnswer = {
  status: 200,
  headers: sse,
  chunks: events([
    start("msg_09B", '{"input_tokens":20,"output_tokens":1}'),
    [
      "content_block_start",
      '{"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_09A","name":"token_info","input":{"symbol":"CAKE"}}}',
    ],
    ["content_block_stop", '{"type":"content_block_stop","index":0}'],
    [
      "message_delta",
      '{"type":"message_delta","delta":{"stop_reason":"tool_use","stop_sequence":null},"usage":{"output_tokens":12}}',
    ],
    stop,
  ]),
};

/** An answer its output limit cut in the middle of a tool call's input. */
export const messagesMaxTokensStream: RecordedAnswer = {
  status: 200,
  headers: sse,
  chunks: events([
    start("msg_04W", '{"input_tokens":50,"output_tokens":1}'),
    [
      "content_block_start",
      '{"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_04A","name":"quote","input":{}}}',
    ],
    [
      "content_block_delta",
      '{"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"amount\\":\\"12"}}',
    ],
    ["content_block_stop", '{"type":"content_block_stop","index":0}'],
    [
      "message_delta",
      '{"type":"message_delta","delta":{"stop_reason":"max_tokens","stop_sequence":null},"usage":{"output_tokens":4096}}',
    ],
    stop,
  ]),
};

/** An answer the model's context window cut. */
export const messagesWindowFullStream: RecordedAnswer = {
  status: 200,
  headers: sse,
  chunks: events([
    start("msg_05X", '{"input_tokens":199000,"output_tokens":1}'),
    [
      "content_block_start",
      '{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
    ],
    [
      "content_block_delta",
      '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"The"}}',
    ],
    ["content_block_stop", '{"type":"content_block_stop","index":0}'],
    [
      "message_delta",
      '{"type":"message_delta","delta":{"stop_reason":"model_context_window_exceeded","stop_sequence":null},"usage":{"output_tokens":1000}}',
    ],
    stop,
  ]),
};

/** An answer the safety classifiers stopped, with its category. */
export const messagesRefusalStream: RecordedAnswer = {
  status: 200,
  headers: sse,
  chunks: events([
    start("msg_06Y", '{"input_tokens":40,"output_tokens":1}'),
    [
      "content_block_start",
      '{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
    ],
    [
      "content_block_delta",
      '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"I can"}}',
    ],
    ["content_block_stop", '{"type":"content_block_stop","index":0}'],
    [
      "message_delta",
      '{"type":"message_delta","delta":{"stop_reason":"refusal","stop_sequence":null,"stop_details":{"type":"refusal","category":"cyber","explanation":"Words the provider chose."}},"usage":{"output_tokens":3}}',
    ],
    stop,
  ]),
};

/** A stream that fails after its first text with an `overloaded_error` event. */
export const messagesOverloadedMidStream: RecordedAnswer = {
  status: 200,
  headers: sse,
  chunks: events([
    start("msg_07Z", '{"input_tokens":40,"output_tokens":1}'),
    [
      "content_block_start",
      '{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
    ],
    [
      "content_block_delta",
      '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Checking"}}',
    ],
    ["error", '{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}'],
  ]),
};

/** A stream whose connection ends after its first text, with no stop reason. */
export const messagesCutStream: RecordedAnswer = {
  status: 200,
  headers: sse,
  chunks: events([
    start("msg_08A", '{"input_tokens":40,"output_tokens":1}'),
    [
      "content_block_start",
      '{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
    ],
    [
      "content_block_delta",
      '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"The price"}}',
    ],
  ]),
};

/** What an error answer says beside its status and error type. */
interface ErrorExtras {
  readonly words?: string;
  readonly headers?: Readonly<Record<string, string>>;
}

/** An error answer in Anthropic's shape, with its status, error type, words and headers. */
export function messagesErrorAnswer(
  status: number,
  type: string,
  { words = "Words the provider chose.", headers = {} }: ErrorExtras = {},
): RecordedAnswer {
  return {
    status,
    headers: { ...json, "request-id": "req_011CSHoEeqs5C35K2UUqR7Fy", ...headers },
    chunks: [
      `{"type":"error","error":{"type":"${type}","message":"${words}"},"request_id":"req_011CSHoEeqs5C35K2UUqR7Fy"}`,
    ],
  };
}

/** The answer to a request over the model's context window, in Anthropic's words. */
export const messagesContextOverflow: RecordedAnswer = messagesErrorAnswer(
  400,
  "invalid_request_error",
  { words: "prompt is too long: 208310 tokens > 200000 maximum" },
);
