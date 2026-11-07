import { createManualClock } from "@binference/core/testing";
import { createFormatter } from "@binference/i18n";
import { describe, expect, it } from "vitest";
import type { ChatContext } from "./chat-context.js";
import { wordsOf } from "./chat-lines.js";
import type { ScreenLine } from "./chat-screen.js";
import { createChatStore } from "./chat-state.js";
import { createCredentialEntry } from "./credential-entry.js";
import { answerAsResult } from "./testing/answer-as-result.schema.js";
import { harnessAgent, harnessNowMs } from "./testing/chat-harness.js";

const request = {
  request: "crq_0190f1c2-3a4b-7c5d-8e6f-000000000001",
  agent: harnessAgent,
  session: "ses_0190f1c2-3a4b-7c5d-8e6f-000000000002",
  turn: "trn_0190f1c2-3a4b-7c5d-8e6f-000000000004",
  name: "DUNE_API_KEY",
  allowedHosts: ["api.dune.com"],
  createdAt: harnessNowMs,
  closesAt: harnessNowMs + 900_000,
};

// An entry on a chat whose engine answers each call from `answers`, and what it called and printed.
function entryOn(answers: Readonly<Record<string, () => object>>) {
  const calls: { readonly op: string; readonly args: object }[] = [];
  const printed: ScreenLine[] = [];
  const formatter = createFormatter({ locale: "en", timeZone: "UTC" });
  const store = createChatStore(() => undefined);
  const context: ChatContext = {
    client: {
      call: async (op, args) => {
        calls.push({ op, args });
        return answerAsResult(answers[op]?.() ?? {});
      },
      subscribe: () => () => undefined,
      status: () => answerAsResult({ state: "ready", ready: {} }),
    },
    agent: answerAsResult(harnessAgent),
    agentName: "main",
    formatter,
    words: wordsOf(formatter),
    clock: createManualClock(harnessNowMs),
    store,
    print: (lines) => printed.push(...lines),
    signal: new AbortController().signal,
  };
  return { entry: createCredentialEntry(context), store, calls, printed };
}

describe("the masked credential entry", () => {
  it("skips the open request on Esc and forgets what was typed", async () => {
    const { entry, store, calls } = entryOn({
      "chat/openCredentialRequest": () => ({ request }),
      "credential/skip": () => ({ session: request.session, turn: request.turn }),
    });
    await entry.reload();
    entry.key({ kind: "type", text: "half" });
    expect(store.get().credential?.length).toBe(4);
    entry.key({ kind: "stop" });
    await Promise.resolve();
    expect(calls.map((call) => call.op)).toStrictEqual([
      "chat/openCredentialRequest",
      "credential/skip",
    ]);
    expect(store.get().credential?.length).toBe(0);
  });

  it("says why a store failed, and leaves a request another surface closed", async () => {
    const { entry, store, printed } = entryOn({
      "chat/openCredentialRequest": () => ({ request }),
      "credential/answer": () => {
        throw Object.assign(new Error("closed"), { code: "credential.closed" });
      },
    });
    await entry.reload();
    entry.key({ kind: "type", text: "x" });
    entry.key({ kind: "send" });
    await Promise.resolve();
    await Promise.resolve();
    expect(printed.at(-1)?.tone).toBe("dim");
    entry.closed({
      kind: "chat/credentialRequestClosed",
      agent: harnessAgent,
      request: "crq_other",
      outcome: "expired",
    });
    expect(store.get().credential).toBeDefined();
    entry.key({ kind: "send" });
    entry.key({ kind: "confirm" });
    expect(store.get().credential?.length).toBe(0);
  });
});
