import { ok } from "@binference/core";
import type { OwnedWallet } from "@binference/custody-privy";
import { type InitContext, type InitStep, refused } from "../init/init-context.js";
import { type RescueAddress, rescueAddressOf } from "../init/rescue-step.js";

function lower(items: readonly string[]): ReadonlySet<string> {
  return new Set(items.map((item) => item.toLowerCase()));
}

// The addresses every ceiling lets a native send pay, as the first ceiling writes them.
function commonRecipients(owned: readonly OwnedWallet[]): readonly string[] {
  const [first, ...rest] = owned;
  const others = rest.map((item) => lower(item.ceiling.recipients));
  return (first?.ceiling.recipients ?? []).filter((address) =>
    others.every((set) => set.has(address.toLowerCase())),
  );
}

function listed(candidates: readonly string[], text: string): RescueAddress | undefined {
  const rescue = rescueAddressOf(text);
  const isListed = candidates.some((item) => item.toLowerCase() === rescue?.address.toLowerCase());
  return isListed ? rescue : undefined;
}

/**
 * The rescue address of a rebuild (decision 0142): one of the addresses every wallet's ceiling
 * lets a send pay, since the rescue address is in every ceiling. It is read when the ceilings
 * share exactly one; otherwise `--rescue` names one of them, or a person picks one.
 */
export async function takeRebuildRescue(
  context: InitContext,
  owned: readonly OwnedWallet[],
): Promise<InitStep<RescueAddress>> {
  const candidates = commonRecipients(owned);
  const addresses = candidates.join(", ");
  const given = context.flags.rescue;
  if (given !== undefined) {
    const rescue = listed(candidates, given);
    return rescue === undefined
      ? refused("init.rebuild_rescue", "refused.rebuildRescue", { addresses })
      : ok(rescue);
  }
  const [only, ...more] = candidates;
  const read = only === undefined || more.length > 0 ? undefined : listed(candidates, only);
  if (read !== undefined) {
    context.prompter.say(context.words("rebuild.rescueRead", { address: read.address }));
    return ok(read);
  }
  if (candidates.length === 0 || !context.isInteractive) {
    return refused("init.rebuild_rescue", "refused.rebuildRescue", { addresses });
  }
  const typed = await context.prompter.ask({
    id: "rescue",
    message: context.words("rebuild.rescueAsk", { addresses }),
    check: (answer) =>
      listed(candidates, answer) === undefined
        ? context.words("rebuild.rescueNotListed")
        : undefined,
  });
  const rescue = listed(candidates, typed);
  return rescue === undefined
    ? refused("init.rebuild_rescue", "refused.rebuildRescue", { addresses })
    : ok(rescue);
}
