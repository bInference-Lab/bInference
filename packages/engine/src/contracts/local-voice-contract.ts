import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import { mediaTypeOf } from "@binference/protocol";
import type { LocalVoice } from "../speech/ports.js";

/**
 * A local voice under test: one that speaks on this machine, and one on a machine it cannot speak
 * on, each in the adapter's own form.
 */
export interface LocalVoiceSubject {
  readonly voice: LocalVoice;
  readonly mute: LocalVoice;
}

/** Makes a fresh {@link LocalVoiceSubject} for each check. */
export interface LocalVoiceHarness {
  create(): Promise<LocalVoiceSubject>;
}

type Check = (subject: LocalVoiceSubject) => Promise<void>;

const live = (): { readonly signal: AbortSignal } => ({ signal: new AbortController().signal });

const speaksAudio: Check = async (subject) => {
  const spoken = await subject.voice.speak({ text: "Your buy filled." }, live());
  assert.ok(spoken.ok);
  assert.notEqual(mediaTypeOf(spoken.value, "voice"), undefined);
};

const speaksWithAVoice: Check = async (subject) => {
  const spoken = await subject.voice.speak({ text: "-v is no option", voice: "Samantha" }, live());
  assert.ok(spoken.ok);
};

const refusesWhereItCannot: Check = async (subject) => {
  assert.deepEqual(await subject.mute.speak({ text: "Hello." }, live()), {
    ok: false,
    error: "unavailable",
  });
};

const stopsOnAbort: Check = async (subject) => {
  const stopped = new Error("stopped");
  const stop = new AbortController();
  stop.abort(stopped);
  await assert.rejects(subject.voice.speak({ text: "Hello." }, stop), stopped);
};

const checks: readonly (readonly [string, Check])[] = [
  ["speaks words as audio a voice note takes", speaksAudio],
  ["speaks with a named voice, words that look like options among them", speaksWithAVoice],
  ["refuses as unavailable where the machine has no voice it drives", refusesWhereItCannot],
  ["rejects with the signal's reason once it aborts", stopsOnAbort],
];

/** The contract every `LocalVoice` adapter passes. */
export function localVoiceContract(harness: LocalVoiceHarness): readonly ContractCheck[] {
  return checks.map(([name, check]) => ({
    name,
    run: async () => check(await harness.create()),
  }));
}
