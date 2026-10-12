import type { RecordedAnswer } from "./recorded-http.js";

// Chat Completions answers written by hand in the shapes the API reference documents for streamed
// chunks (`chat.completion.chunk`), errors (`{ "error": { message, type, param, code } }`), and the
// fields compatible gateways add: SSE comment lines while a model warms up, `reasoning` text,
// `usage.cost` in US dollars, and an error event in the middle of a stream.

const sse = { "content-type": "text/event-stream" };
const json = { "content-type": "application/json" };

// Each line is one server-sent event.
const events = (lines: readonly string[]): readonly string[] => lines.map((line) => `${line}\n\n`);

/** A text answer that stops on its own, with its usage in the last chunk. */
export const textStream: RecordedAnswer = {
  status: 200,
  headers: sse,
  chunks: events([
    'data: {"id":"chatcmpl-B1","object":"chat.completion.chunk","created":1760000000,"model":"gpt-5-mini","system_fingerprint":"fp_1","choices":[{"index":0,"delta":{"role":"assistant","content":"","refusal":null},"logprobs":null,"finish_reason":null}],"usage":null}',
    'data: {"id":"chatcmpl-B1","object":"chat.completion.chunk","created":1760000000,"model":"gpt-5-mini","choices":[{"index":0,"delta":{"content":"BNB is"},"logprobs":null,"finish_reason":null}],"usage":null}',
    'data: {"id":"chatcmpl-B1","object":"chat.completion.chunk","created":1760000000,"model":"gpt-5-mini","choices":[{"index":0,"delta":{"content":" up 2% today."},"logprobs":null,"finish_reason":null}],"usage":null}',
    'data: {"id":"chatcmpl-B1","object":"chat.completion.chunk","created":1760000000,"model":"gpt-5-mini","choices":[{"index":0,"delta":{},"logprobs":null,"finish_reason":"stop"}],"usage":null}',
    'data: {"id":"chatcmpl-B1","object":"chat.completion.chunk","created":1760000000,"model":"gpt-5-mini","choices":[],"usage":{"prompt_tokens":812,"completion_tokens":9,"total_tokens":821,"prompt_tokens_details":{"cached_tokens":768,"audio_tokens":0},"completion_tokens_details":{"reasoning_tokens":0,"audio_tokens":0,"accepted_prediction_tokens":0,"rejected_prediction_tokens":0}}}',
    "data: [DONE]",
  ]),
};

/** Two tool calls, the first one's arguments in pieces, then `tool_calls`. */
export const toolCallsStream: RecordedAnswer = {
  status: 200,
  headers: sse,
  chunks: events([
    'data: {"id":"chatcmpl-C2","object":"chat.completion.chunk","created":1760000001,"model":"gpt-5-mini","choices":[{"index":0,"delta":{"role":"assistant","content":"Let me check.","refusal":null},"logprobs":null,"finish_reason":null}],"usage":null}',
    'data: {"id":"chatcmpl-C2","object":"chat.completion.chunk","created":1760000001,"model":"gpt-5-mini","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_Qx1","type":"function","function":{"name":"token_info","arguments":""}}]},"logprobs":null,"finish_reason":null}],"usage":null}',
    'data: {"id":"chatcmpl-C2","object":"chat.completion.chunk","created":1760000001,"model":"gpt-5-mini","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"sym"}}]},"logprobs":null,"finish_reason":null}],"usage":null}',
    'data: {"id":"chatcmpl-C2","object":"chat.completion.chunk","created":1760000001,"model":"gpt-5-mini","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"bol\\":\\"CAKE\\"}"}}]},"logprobs":null,"finish_reason":null}],"usage":null}',
    'data: {"id":"chatcmpl-C2","object":"chat.completion.chunk","created":1760000001,"model":"gpt-5-mini","choices":[{"index":0,"delta":{"tool_calls":[{"index":1,"id":"call_Qx2","type":"function","function":{"name":"portfolio","arguments":"{}"}}]},"logprobs":null,"finish_reason":null}],"usage":null}',
    'data: {"id":"chatcmpl-C2","object":"chat.completion.chunk","created":1760000001,"model":"gpt-5-mini","choices":[{"index":0,"delta":{},"logprobs":null,"finish_reason":"tool_calls"}],"usage":null}',
    'data: {"id":"chatcmpl-C2","object":"chat.completion.chunk","created":1760000001,"model":"gpt-5-mini","choices":[],"usage":{"prompt_tokens":1200,"completion_tokens":41,"total_tokens":1241,"prompt_tokens_details":{"cached_tokens":0},"completion_tokens_details":{"reasoning_tokens":0}}}',
    "data: [DONE]",
  ]),
};

/** A gateway's answer: comment lines first, reasoning, text, and the call's cost on the usage. */
export const gatewayStream: RecordedAnswer = {
  status: 200,
  headers: sse,
  chunks: events([
    ": PROCESSING",
    ": PROCESSING",
    'data: {"id":"gen-17600-a","provider":"Anthropic","model":"anthropic/claude-sonnet-4.5","object":"chat.completion.chunk","created":1760000002,"choices":[{"index":0,"delta":{"role":"assistant","content":"","reasoning":"The owner asks for the price."},"finish_reason":null,"native_finish_reason":null,"logprobs":null}]}',
    'data: {"id":"gen-17600-a","provider":"Anthropic","model":"anthropic/claude-sonnet-4.5","object":"chat.completion.chunk","created":1760000002,"choices":[{"index":0,"delta":{"role":"assistant","content":"About $612."},"finish_reason":null,"native_finish_reason":null,"logprobs":null}]}',
    'data: {"id":"gen-17600-a","provider":"Anthropic","model":"anthropic/claude-sonnet-4.5","object":"chat.completion.chunk","created":1760000002,"choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":"stop","native_finish_reason":"end_turn","logprobs":null}]}',
    'data: {"id":"gen-17600-a","provider":"Anthropic","model":"anthropic/claude-sonnet-4.5","object":"chat.completion.chunk","created":1760000002,"choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null,"native_finish_reason":null,"logprobs":null}],"usage":{"prompt_tokens":5321,"completion_tokens":24,"total_tokens":5345,"cost":0.0024567891,"is_byok":false,"prompt_tokens_details":{"cached_tokens":4096},"completion_tokens_details":{"reasoning_tokens":12}}}',
    "data: [DONE]",
  ]),
};

/** An answer its output limit cut in the middle of a tool call's arguments. */
export const lengthStream: RecordedAnswer = {
  status: 200,
  headers: sse,
  chunks: events([
    'data: {"id":"chatcmpl-D3","object":"chat.completion.chunk","created":1760000003,"model":"gpt-5-mini","choices":[{"index":0,"delta":{"role":"assistant","content":null,"tool_calls":[{"index":0,"id":"call_Ln1","type":"function","function":{"name":"quote","arguments":"{\\"amount\\":\\"12"}}]},"logprobs":null,"finish_reason":null}]}',
    'data: {"id":"chatcmpl-D3","object":"chat.completion.chunk","created":1760000003,"model":"gpt-5-mini","choices":[{"index":0,"delta":{},"logprobs":null,"finish_reason":"length"}]}',
    "data: [DONE]",
  ]),
};

/** An answer the provider's content filter stopped. */
export const contentFilterStream: RecordedAnswer = {
  status: 200,
  headers: sse,
  chunks: events([
    'data: {"id":"chatcmpl-E4","object":"chat.completion.chunk","created":1760000004,"model":"gpt-5-mini","choices":[{"index":0,"delta":{"role":"assistant","content":"I can"},"logprobs":null,"finish_reason":null}]}',
    'data: {"id":"chatcmpl-E4","object":"chat.completion.chunk","created":1760000004,"model":"gpt-5-mini","choices":[{"index":0,"delta":{},"logprobs":null,"finish_reason":"content_filter"}]}',
    "data: [DONE]",
  ]),
};

/** A gateway's stream that fails after its first text with an error event. */
export const midStreamErrorStream: RecordedAnswer = {
  status: 200,
  headers: sse,
  chunks: events([
    'data: {"id":"gen-17600-b","object":"chat.completion.chunk","created":1760000005,"model":"anthropic/claude-sonnet-4.5","choices":[{"index":0,"delta":{"role":"assistant","content":"Checking"},"finish_reason":null}]}',
    'data: {"id":"gen-17600-b","object":"chat.completion.chunk","created":1760000005,"model":"anthropic/claude-sonnet-4.5","provider":"Anthropic","error":{"code":"server_error","message":"Provider disconnected unexpectedly"},"choices":[{"index":0,"delta":{"content":""},"finish_reason":"error"}]}',
  ]),
};

/** A stream whose connection ends after its first text, with no stop reason and no `[DONE]`. */
export const cutStream: RecordedAnswer = {
  status: 200,
  headers: sse,
  chunks: events([
    'data: {"id":"chatcmpl-F6","object":"chat.completion.chunk","created":1760000006,"model":"gpt-5-mini","choices":[{"index":0,"delta":{"role":"assistant","content":"The price"},"logprobs":null,"finish_reason":null}]}',
  ]),
};

/** The answer to a request over the model's context window, with OpenAI's documented code. */
export const contextOverflow: RecordedAnswer = {
  status: 400,
  headers: json,
  chunks: [
    '{"error":{"message":"This model\'s maximum context length is 128000 tokens. However, your messages resulted in 131072 tokens. Please reduce the length of the messages.","type":"invalid_request_error","param":"messages","code":"context_length_exceeded"}}',
  ],
};

/** A gateway's answer to a request over the context window: no code, only its words. */
export const gatewayContextOverflow: RecordedAnswer = {
  status: 400,
  headers: json,
  chunks: [
    '{"error":{"message":"This endpoint\'s maximum context length is 200000 tokens. However, you requested about 231044 tokens (227000 of text input, 4044 in the output). Please reduce the length of either one.","code":400}}',
  ],
};

/** An error answer with a status, a documented code and the headers the provider sent. */
export function errorAnswer(
  status: number,
  code: string,
  headers: Readonly<Record<string, string>> = {},
): RecordedAnswer {
  return {
    status,
    headers: { ...json, ...headers },
    chunks: [
      `{"error":{"message":"Words the provider chose.","type":"error","param":null,"code":"${code}"}}`,
    ],
  };
}
