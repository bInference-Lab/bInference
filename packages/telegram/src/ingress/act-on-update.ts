import type { Clock, Logger } from "@binference/core";
import type { AccessStore } from "@binference/engine";
import type { OwnerStore } from "@binference/engine/surfaces";
import { startCodeHash } from "../pairing/start-code.js";
import type { BotCalls } from "./bot-calls.js";
import type { OwnerUpdate, ReplyTarget, UpdateAction } from "./decide-update.js";

/** The words the ingress sends, each under its message key. */
export type IngressWords = "telegram.paired" | "telegram.pairRefused" | "telegram.secretDeleted";

/** Takes an owner update and resolves once it holds it, not after acting on it. */
export type OwnerUpdateSink = (
  update: OwnerUpdate,
  options: { readonly signal: AbortSignal },
) => Promise<void>;

/** What carrying out an {@link UpdateAction} needs. */
export interface ActionContext {
  readonly calls: BotCalls;
  readonly access: AccessStore;
  readonly owners: OwnerStore;
  readonly clock: Clock;
  readonly logger: Logger;
  /** The text of a message key in the target's language. */
  readonly words: (key: IngressWords, target: ReplyTarget) => string;
  readonly onOwnerUpdate: OwnerUpdateSink;
  /** Hears that a start code bound the owner. */
  readonly onOwnerPaired: () => void;
}

interface Call {
  readonly signal: AbortSignal;
}

interface Line {
  readonly key: IngressWords;
  readonly target: ReplyTarget;
}

type PairAction = Extract<UpdateAction, { kind: "pair" }>;
type SecretAction = Extract<UpdateAction, { kind: "deleteSecret" }>;

async function say(context: ActionContext, line: Line, call: Call): Promise<void> {
  await context.calls.reply(line.target, context.words(line.key, line.target), call);
}

// The code is spent before the owner is bound: a code works once even if binding fails.
async function pair(action: PairAction, context: ActionContext, call: Call): Promise<void> {
  const codeHash = startCodeHash(action.code);
  const used = await context.access.usePairCode({ codeHash, atMs: context.clock.now() }, call);
  const bound = used.ok
    ? await context.owners.bind({ userId: action.userId, pairedAtMs: context.clock.now() }, call)
    : used;
  if (!bound.ok) {
    context.logger.warn("telegram.pairing_refused");
    await say(context, { key: "telegram.pairRefused", target: action.target }, call);
    return;
  }
  context.logger.info("telegram.owner_paired");
  try {
    await say(context, { key: "telegram.paired", target: action.target }, call);
  } finally {
    // The welcome goes first; what waited for the owner follows, sent or not.
    context.onOwnerPaired();
  }
}

// Deleted first, so the secret leaves the chat even when the warning cannot be sent yet.
async function deleteSecret(action: SecretAction, context: ActionContext, call: Call) {
  await context.calls.deleteMessage(action.target.chatId, action.messageId, call);
  context.logger.warn("telegram.secret_deleted");
  await say(context, { key: "telegram.secretDeleted", target: action.target }, call);
}

/** Carries out one decided action: pairs, deletes a secret, welcomes or hands an update on. */
export async function actOnUpdate(
  action: UpdateAction,
  context: ActionContext,
  call: Call,
): Promise<void> {
  switch (action.kind) {
    case "ignore":
      return;
    case "pair":
      await pair(action, context, call);
      return;
    case "welcome":
      await say(context, { key: "telegram.paired", target: action.target }, call);
      return;
    case "deleteSecret":
      await deleteSecret(action, context, call);
      return;
    case "deliver":
      await context.onOwnerUpdate(action.update, call);
      return;
  }
}
