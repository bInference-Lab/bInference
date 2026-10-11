import type { Clock, Logger } from "@binference/core";
import type { AccessStore } from "@binference/engine";
import type { OwnerBinding, OwnerStore } from "@binference/engine/surfaces";
import { startCodeHash } from "../pairing/start-code.js";
import type { BotCalls } from "./bot-calls.js";
import type { OwnerUpdate, ReplyTarget, UpdateAction } from "./decide-update.js";

/** The words the ingress sends, each under its message key. */
export type IngressWords =
  | "telegram.paired"
  | "telegram.pairRefused"
  | "telegram.pairingEnded"
  | "telegram.secretDeleted";

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
  /**
   * Hears that a start code bound the owner, the first or one in an earlier owner's place, with the
   * owner it replaced.
   */
  readonly onOwnerPaired: (replaced: OwnerBinding | undefined) => void;
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

// The owner a new pairing replaced hears it in their own chat, whose id is their user id, so
// someone who paired without them knowing can be frozen out at once.
async function tellReplaced(
  replaced: OwnerBinding | undefined,
  context: ActionContext,
  call: Call,
): Promise<void> {
  if (replaced === undefined) {
    return;
  }
  context.logger.warn("telegram.owner_replaced");
  await say(context, { key: "telegram.pairingEnded", target: { chatId: replaced.userId } }, call);
}

// The code is spent before the owner is bound: a code works once even if binding fails. The earlier
// owner, if any, stays until a code is spent.
async function pair(action: PairAction, context: ActionContext, call: Call): Promise<void> {
  const codeHash = startCodeHash(action.code);
  const used = await context.access.usePairCode({ codeHash, atMs: context.clock.now() }, call);
  if (!used.ok) {
    context.logger.warn("telegram.pairing_refused");
    await say(context, { key: "telegram.pairRefused", target: action.target }, call);
    return;
  }
  const binding = { userId: action.userId, pairedAtMs: context.clock.now() };
  const replaced = await context.owners.bind(binding, call);
  context.logger.info("telegram.owner_paired");
  try {
    await say(context, { key: "telegram.paired", target: action.target }, call);
  } finally {
    // The welcome goes first, then the word to the replaced owner and what waited for the owner,
    // sent or not.
    try {
      await tellReplaced(replaced, context, call);
    } finally {
      context.onOwnerPaired(replaced);
    }
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
