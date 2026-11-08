import { err, ok } from "@binference/core";
import type { LocalVoice } from "../speech/ports.js";

/** A {@link LocalVoice} that records what it was asked to speak. */
export interface FakeLocalVoice extends LocalVoice {
  /** Each request it was asked, in order. */
  readonly spoken: readonly { readonly text: string; readonly voice?: string }[];
}

/** The bytes the fake speaks: an M4A's opening `ftyp` box, then the words. */
export function fakeVoiceBytes(text: string): Uint8Array {
  const box = [0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20];
  return new Uint8Array([...box, ...new TextEncoder().encode(text)]);
}

/**
 * Creates a {@link FakeLocalVoice}: it speaks each request as {@link fakeVoiceBytes}, or refuses
 * every one as `unavailable` with `mute`.
 */
export function createFakeLocalVoice(options: { readonly mute?: boolean } = {}): FakeLocalVoice {
  const spoken: { readonly text: string; readonly voice?: string }[] = [];
  return {
    spoken,
    speak: async (request, call) => {
      call.signal.throwIfAborted();
      if (options.mute === true) {
        return Promise.resolve(err("unavailable"));
      }
      spoken.push(request);
      return Promise.resolve(ok(fakeVoiceBytes(request.text)));
    },
  };
}
