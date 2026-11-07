import { callModel } from "../loop/model-call.js";
import type { ModelImage } from "../loop/model-message.js";
import type { ModelChain } from "../loop/ports.js";
import { createModelRoute, type TurnRun } from "../loop/turn-run.js";
import { endOfFault, type LoopEnd } from "../loop/turn-step.js";
import { describePrefix, maxDescription } from "./describe-words.js";

/** A description, or how the turn ends when the vision model gave none. */
export type Described =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly end: LoopEnd };

/**
 * The vision model's description of one image (decision 0227): one call on the vision chain,
 * its usage recorded on the turn like any other. A call that fails ends the turn as a main model's
 * fault would; an empty answer says the model saw nothing to describe.
 */
export async function describeImage(
  run: TurnRun,
  vision: ModelChain,
  image: ModelImage,
): Promise<Described> {
  const request = {
    prefix: describePrefix,
    messages: [{ role: "owner" as const, text: "Describe this image.", images: [image] }],
    tools: [],
  };
  const response = await callModel(run, request, { chain: vision, route: createModelRoute() });
  if (!response.ok) {
    return { ok: false, end: endOfFault(run, response) };
  }
  const text = response.text.trim();
  const said = text === "" ? "The vision model found nothing to describe." : text;
  return { ok: true, text: said.slice(0, maxDescription) };
}
