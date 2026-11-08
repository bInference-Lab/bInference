import { BinferenceError } from "@binference/core";
import { createSeededRandom } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import type { SpeechMaker, SpeechOutcome, SpeechSource } from "../providers/speech-making.js";
import { agent, context, toolTurn } from "../testing/agent-tool-fixtures.js";
import { createFakeToolClient, type FakeAnswer } from "../testing/fake-tool-client.js";
import { speakTool } from "./speak-tool.js";

const opus = new TextEncoder().encode("OggS opus pages");
const saved = {
  media: "e5f60718293a4b5c",
  kind: "voice",
  contentType: "audio/ogg",
  bytes: opus.byteLength,
  path: "/owner/.binference/workspace/media/speech/2026-11-08/e5f60718293a4b5c.ogg",
};
const words = "Your BNB buy filled at 612 dollars.";

// A speech model that answers every request with `outcome`, and keeps what it was asked.
function modelOf(outcome: SpeechOutcome) {
  const asked: { readonly text: string; readonly voice?: string }[] = [];
  const maker: SpeechMaker = {
    model: "oa/gpt-4o-mini-tts",
    speak: async (request) => {
      asked.push(request);
      return Promise.resolve(outcome);
    },
  };
  return { source: { kind: "model", maker } satisfies SpeechSource, asked };
}

function toolOn(
  answers: Readonly<Record<string, FakeAnswer>>,
  speaking: { readonly source: SpeechSource; readonly voice?: string },
) {
  const client = createFakeToolClient(answers);
  const tool = speakTool(
    { agent, client, turn: toolTurn },
    { ...speaking, random: createSeededRandom(4) },
  );
  const run = async (args: object) => {
    const prepared = tool.prepare(JSON.stringify(args));
    if (!prepared.ready) {
      throw new Error(prepared.text);
    }
    return prepared.run(context);
  };
  return { run, client };
}

const engine = {
  "media/store": { media: saved },
  "media/send": {},
  "speech/local": { media: saved },
};

describe("the speak tool", () => {
  it("speaks with the model in the owner's voice, saves the audio and sends it as shown words", async () => {
    const model = modelOf({ ok: true, audio: opus });
    const chat = toolOn(engine, { source: model.source, voice: "verse" });
    const outcome = await chat.run({ text: words });
    expect(outcome).toMatchObject({ isError: false, shown: [words] });
    expect(outcome.text).toContain("Never write the same words again as text");
    expect(model.asked).toStrictEqual([{ text: words, voice: "verse" }]);
    const calls = chat.client.calls();
    expect(calls.map((call) => call.op)).toStrictEqual(["media/store", "media/send"]);
    expect(calls[0]?.args).toMatchObject({ kind: "voice", total: opus.byteLength });
    expect(calls[1]?.args).toMatchObject({ turn: toolTurn.turn, media: saved.media });
  });

  it("speaks with the machine's own voice for local, the call's voice first", async () => {
    const chat = toolOn(engine, { source: { kind: "local" }, voice: "Samantha" });
    await chat.run({ text: words, voice: "Daniel" });
    expect(chat.client.calls()).toMatchObject([
      { op: "speech/local", args: { text: words, voice: "Daniel" } },
      { op: "media/send", args: { media: saved.media } },
    ]);
  });

  it("says why nothing spoke: no setting, a model's failure, a refused local voice", async () => {
    const none = toolOn(engine, { source: { kind: "none", failure: "Nothing speaks." } });
    expect(await none.run({ text: words })).toMatchObject({
      isError: true,
      text: "Nothing speaks.",
    });
    const failing = toolOn(engine, { source: modelOf({ ok: false, failure: "no key" }).source });
    expect((await failing.run({ text: words })).text).toBe(
      "Speaking failed: no key. Tell the owner in a line.",
    );
    const unavailable = new BinferenceError({ code: "speech.local_unavailable", message: "No." });
    const linux = toolOn({ ...engine, "speech/local": unavailable }, { source: { kind: "local" } });
    expect((await linux.run({ text: words })).text).toContain("only macOS does");
    const failed = new BinferenceError({ code: "speech.failed", message: "No." });
    const wrongVoice = toolOn({ ...engine, "speech/local": failed }, { source: { kind: "local" } });
    expect((await wrongVoice.run({ text: words })).text).toContain("speech.voice must name");
    const odd = toolOn(
      { ...engine, "speech/local": new Error("closed") },
      { source: { kind: "local" } },
    );
    expect((await odd.run({ text: words })).text).toBe(
      "The machine's voice could not speak the words.",
    );
  });

  it("says when the speech could not be kept, and sends nothing", async () => {
    const refusing = toolOn(
      { ...engine, "media/store": new Error("closed") },
      { source: modelOf({ ok: true, audio: opus }).source },
    );
    expect(await refusing.run({ text: words })).toMatchObject({
      isError: true,
      text: "The speech could not be saved in your workspace.",
    });
    expect(refusing.client.calls().map((call) => call.op)).toStrictEqual(["media/store"]);
  });
});
