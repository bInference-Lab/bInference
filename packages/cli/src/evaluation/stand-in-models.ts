import type { Clock } from "@binference/core";
import {
  callsReply,
  createScriptedTransport,
  createTestChain,
  type ModelChain,
  oneModelChain,
  textReply,
} from "@binference/runtime/testing";
import type { StandInReply } from "./scenario.schema.js";

// Scripted stand-ins for the model under evaluation and for the vision model: each answers the
// calls of a run with its replies, in order. They prove the scenarios and the scorer offline.

function eventsOf(reply: StandInReply, index: number) {
  const calls = (reply.calls ?? []).map((call, at) => ({
    id: `call_${String(index + 1)}_${String(at + 1)}`,
    name: call.name,
    args: call.args,
  }));
  return calls.length === 0 ? textReply(reply.text ?? "") : callsReply(calls, reply.text ?? "");
}

/** A model that answers a run's calls with the replies given, in order, then fails. */
export function standInChain(replies: readonly StandInReply[], clock: Clock): ModelChain {
  return oneModelChain(createScriptedTransport(replies.map(eventsOf)), clock);
}

/** The vision model of a run: it describes each of the owner's images with the words given. */
export function visionChain(descriptions: readonly string[], clock: Clock): ModelChain {
  const transport = createScriptedTransport(descriptions.map((text) => textReply(text)));
  return createTestChain([{ name: "evaluation/vision", transport, readsImages: true }], { clock });
}
