import { setTimeout as wait } from "node:timers/promises";
import { BinferenceError, type Id } from "@binference/core";
import { cardLineText, createFormatter } from "@binference/i18n";
import type { IntentRequest, IntentView } from "@binference/protocol";
import type { RescueRig } from "./rescue-rig.js";

// The owner's CLI, as the server signs it in over IPC.
const owner = {
  credential: "tok_0190f1c2-3a4b-7c5d-8e6f-000000000066",
  client: { kind: "cli", version: "fork" },
  scopes: ["read", "propose", "confirm", "loosen"],
  transport: "ipc",
} as const;

/** The states an intent the rig runs ends in. */
export const endedStates: readonly string[] = [
  "reconciled",
  "failed_check",
  "failed_onchain",
  "expired",
  "cancelled",
];

/** An engine call of the owner's CLI with its args, as the rig's handlers take it. */
export function ownerCall<Args>(
  args: Args,
  signal: AbortSignal,
): { readonly args: Args; readonly caller: typeof owner; readonly signal: AbortSignal } {
  return { args, caller: owner, signal };
}

/** The answer's value; a refusal fails the fork test with its code. */
export function expectValue<T>(
  result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string },
): T {
  if (!result.ok) {
    throw new BinferenceError({ code: "fork.refused", message: result.error });
  }
  return result.value;
}

/** Proposes the request as the owner's CLI and answers the intent's view. */
export async function proposeOn(
  rig: RescueRig,
  request: IntentRequest,
  signal: AbortSignal,
): Promise<IntentView> {
  return expectValue(await rig.engine.handlers["intent/propose"](ownerCall(request, signal)));
}

/** The intent's card in English, a line each, as the owner reads it. */
export async function cardTextOf(
  rig: RescueRig,
  view: IntentView,
  signal: AbortSignal,
): Promise<readonly string[]> {
  const drawn = expectValue(
    await rig.engine.handlers["intent/card"](ownerCall({ intent: view.intent }, signal)),
  );
  const display = {
    formatter: createFormatter({ locale: "en", timeZone: "UTC" }),
    assets: drawn.assets,
  };
  return drawn.lines.map((line) => cardLineText(line, display));
}

/** The owner's tap on the intent's first card version. */
export async function confirmOn(
  rig: RescueRig,
  view: IntentView,
  signal: AbortSignal,
): Promise<void> {
  const card = view.card?.card;
  if (card === undefined) {
    throw new BinferenceError({ code: "fork.no_card", message: `${view.kind} opened no card.` });
  }
  expectValue(
    await rig.engine.handlers["intent/confirm"](
      ownerCall({ intent: view.intent, card, cardVersion: 1 }, signal),
    ),
  );
}

/** The intent's state once it reaches one of `states`, or after 30 seconds, whichever is first. */
export async function reachOn(
  rig: RescueRig,
  intent: Id<"int">,
  states: readonly string[],
): Promise<string> {
  const deadline = Date.now() + 30_000;
  const poll = async (): Promise<string> => {
    const record = await rig.stores.intents.get(intent, { signal: AbortSignal.timeout(5_000) });
    if ((record !== undefined && states.includes(record.state)) || Date.now() > deadline) {
      return record?.state ?? "missing";
    }
    await wait(200);
    return poll();
  };
  return poll();
}
