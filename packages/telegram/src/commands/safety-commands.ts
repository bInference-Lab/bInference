import { callOrSay, type CommandContext } from "./command-context.js";

/**
 * `/freeze`: freezes every agent and the install at once, from Telegram (ARCHITECTURE.md rule 11).
 * It always answers, since a freeze of what is frozen already announces nothing new.
 */
export async function runFreeze(context: CommandContext): Promise<void> {
  const frozen = await callOrSay(context, "safety/freeze", {});
  if (frozen !== undefined) {
    const when = context.formatter.dateTime(frozen.frozenAt);
    await context.say(context.words("cmd.freeze.done", { when }));
  }
}

/**
 * `/rescue`: opens the rescue card of every agent wallet, while frozen and in paper mode too
 * (decisions 0099, 0100), and answers under it; the owner's tap on it confirms the rescue. While a
 * rescue has not ended, it is that one (decision 0125): its card again, or how far it got.
 */
export async function runRescue(context: CommandContext): Promise<void> {
  const rescue = await callOrSay(context, "safety/rescue", {});
  if (rescue === undefined) {
    return;
  }
  const { signal } = context;
  const card = (await context.waiting({ signal })).find((open) => open.intent === rescue.intent);
  const shown = card === undefined ? undefined : await context.cards.show(card, { signal });
  if (shown?.ok === true) {
    await context.say(context.words("cmd.rescue.waiting"), { replyTo: shown.value.messageId });
    return;
  }
  const safety = await callOrSay(context, "safety/status", {});
  if (safety !== undefined) {
    const state = safety.rescue?.state;
    await context.say(
      state === undefined
        ? context.words("cmd.rescue.ended")
        : context.words("cmd.rescue.underWay", { state }),
    );
  }
}

/**
 * `/cancel`: each card that waits for the owner's answer, sent again with its Cancel button
 * alone, oldest first. A tap cancels it as the card's own button does, and every copy becomes the
 * receipt.
 */
export async function runCancel(context: CommandContext): Promise<void> {
  const { signal } = context;
  const waiting = await context.waiting({ signal });
  if (waiting.length === 0) {
    await context.say(context.words("cmd.cancel.none"));
    return;
  }
  await context.say(context.words("cmd.cancel.heading", { count: waiting.length }));
  // One at a time, so the cards reach the chat oldest first.
  await waiting.reduce(async (previous, card) => {
    await previous;
    await context.cards.offerCancel(card, { signal });
  }, Promise.resolve());
}
