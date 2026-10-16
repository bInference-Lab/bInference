import type { Http, HttpRequest, HttpResponse } from "@binference/core";
import { z } from "zod";

/** The key the fake model provider takes; any other is refused as OpenAI and Anthropic refuse. */
export const testModelKey = "sk-test-5f0c1e9a2b7d4c33";
/** The model the fake model provider serves; any other is unknown to it. */
export const testModelId = "test-model";

/** A fake model provider for init and check: Chat Completions and Messages at any address. */
export interface FakeModelProvider {
  readonly http: Http;
  /** The requests it answered, oldest first. */
  readonly requests: readonly HttpRequest[];
}

const json = { "content-type": "application/json" };
const bodySchema = z.looseObject({ model: z.string() });

function answer(status: number, body: object): HttpResponse {
  return { status, headers: json, body: JSON.stringify(body) };
}

function chatAnswer(request: HttpRequest, model: string): HttpResponse {
  if (request.headers?.["authorization"] !== `Bearer ${testModelKey}`) {
    const error = { message: "Incorrect API key provided.", type: "invalid_request_error" };
    return answer(401, { error: { ...error, param: null, code: "invalid_api_key" } });
  }
  if (model !== testModelId) {
    const message = `The model \`${model}\` does not exist or you do not have access to it.`;
    const error = { message, type: "invalid_request_error", param: null };
    return answer(404, { error: { ...error, code: "model_not_found" } });
  }
  const choice = { index: 0, message: { role: "assistant", content: "Hi" }, finish_reason: "stop" };
  return answer(200, { id: "chatcmpl-1", object: "chat.completion", model, choices: [choice] });
}

function messagesAnswer(request: HttpRequest, model: string): HttpResponse {
  if (request.headers?.["x-api-key"] !== testModelKey) {
    const error = { type: "authentication_error", message: "invalid x-api-key" };
    return answer(401, { type: "error", error });
  }
  if (model !== testModelId) {
    return answer(404, {
      type: "error",
      error: { type: "not_found_error", message: `model: ${model}` },
    });
  }
  const content = [{ type: "text", text: "Hi" }];
  return answer(200, { id: "msg_1", type: "message", role: "assistant", model, content });
}

/**
 * Creates a fake model provider: a Chat Completions or Messages call with {@link testModelKey}
 * and {@link testModelId} gets a short answer; another key gets 401, another model 404, in the
 * provider's documented shape. Anything else gets 404.
 */
export function createFakeModelProvider(): FakeModelProvider {
  const requests: HttpRequest[] = [];
  const http: Http = {
    request: async (request) => {
      requests.push(request);
      const { model } = bodySchema.parse(JSON.parse(request.body ?? "{}"));
      const { pathname } = new URL(request.url);
      if (pathname.endsWith("/chat/completions")) {
        return chatAnswer(request, model);
      }
      return pathname.endsWith("/v1/messages")
        ? messagesAnswer(request, model)
        : answer(404, { error: "Not Found" });
    },
  };
  return { http, requests };
}

/** Whether a request goes to a model provider: a Chat Completions or Messages call. */
export function isModelCall(request: HttpRequest): boolean {
  const { pathname } = new URL(request.url);
  return pathname.endsWith("/chat/completions") || pathname.endsWith("/v1/messages");
}
