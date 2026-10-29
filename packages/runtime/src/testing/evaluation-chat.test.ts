import { createSecret } from "@binference/core";
import { createManualClock, createScriptedHttp } from "@binference/core/testing";
import { intentViewSchema } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { endpointModelChain } from "../providers/endpoint-model-chain.js";
import { agent, coin, intentWire, swapTerms, token } from "./agent-tool-fixtures.js";
import { startEvaluationChat } from "./evaluation-chat.js";
import { createFakeToolClient } from "./fake-tool-client.js";
import { createMemoryContextSource } from "./memory-context-source.js";
import { textStream } from "./recorded-chat-streams.js";
import {
  callsReply,
  createScriptedTransport,
  oneModelChain,
  textReply,
} from "./scripted-transport.js";

const context = createMemoryContextSource();

describe("startEvaluationChat", () => {
  it("runs the agent's own instructions and tools, and the turn a settled proposal starts", async ({
    signal,
  }) => {
    const clock = createManualClock(10_000);
    const transport = createScriptedTransport([
      callsReply([{ name: "swap", args: swapTerms }]),
      textReply("The swap filled."),
    ]);
    const answers = { "intent/propose": intentWire("awaiting_confirmation") };
    const client = createFakeToolClient(answers);
    const models = oneModelChain(transport, clock);
    const chat = await startEvaluationChat({
      agent,
      locale: "zh",
      models,
      client,
      context,
      clock,
      signal,
    });
    await chat.say("Swap 1 FAKE for the token");
    const filled = intentViewSchema.parse(intentWire("paper_filled"));
    await chat.settle(filled);
    expect(client.calls().map((call) => call.op)).toEqual(["intent/propose"]);
    expect(client.calls()[0]?.args).toMatchObject({ agent, from: coin, to: token });
    expect(transport.requests[0]?.prefix).toContain("Write to the owner in Simplified Chinese.");
    const kinds = (await chat.events()).map((event) => `${event.role}/${event.kind}`);
    expect(kinds).toContain("agent/tool_call");
    expect(kinds.at(-1)).toBe("agent/text");
    expect(chat.outcomes()).toEqual(["ok", "ok"]);
  });

  it("reaches a Chat Completions endpoint with the key in the request's header", async ({
    signal,
  }) => {
    const clock = createManualClock(10_000);
    const url = "https://models.example.com/v1/chat/completions";
    const body = textStream.chunks.join("");
    const http = createScriptedHttp([
      { method: "POST", url, response: { status: 200, headers: textStream.headers, body } },
    ]);
    const endpoint = {
      baseUrl: "https://models.example.com/v1",
      apiKey: createSecret("sk-evaluation"),
      model: "gpt-5-mini",
    };
    const models = endpointModelChain(endpoint, { http, clock, timeoutMs: 30_000 });
    const client = createFakeToolClient({});
    const chat = await startEvaluationChat({
      agent,
      locale: "en",
      models,
      client,
      context,
      clock,
      signal,
    });
    await chat.say("How is BNB doing?");
    const said = (await chat.events()).filter((event) => event.role === "agent");
    expect(said.map((event) => event.content)).toEqual([
      expect.objectContaining({ text: "BNB is up 2% today." }),
    ]);
    expect(http.requests()[0]?.headers).toMatchObject({ authorization: "Bearer sk-evaluation" });
    expect(models.models.map((model) => model.name)).toEqual(["endpoint/gpt-5-mini"]);
  });
});
