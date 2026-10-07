import { createSecret, type Id, ok, type Secret, type SecretStore } from "@binference/core";
import { createPassphraseSecretStore } from "@binference/platform";
import { createAgentKey, openAgentKey, parseAgentKey } from "@binference/signer";
import type { UnlockMode } from "../config/schema/engine.schema.js";
import { type CommandSource, commandSourceSchema } from "../config/schema/secret-source.schema.js";
import { type InitContext, type InitStep, refused } from "./init-context.js";
import { secretPlaceOf } from "./secret-places.js";
import { readFlagSecret, sourceOf } from "./take-secret.js";

/** This machine's agent key as init leaves it: its public half, and whether init made it. */
export interface AgentKey {
  /** DER SubjectPublicKeyInfo in base64: what the key quorum of the wallets' signer holds. */
  readonly publicKey: string;
  /** False when the unlock mode held a key already, which init keeps. */
  readonly isNew: boolean;
}

const minPassphraseLength = 12;
const maxTries = 3;

async function askPassphrase(context: InitContext, tries: number): Promise<InitStep<Secret>> {
  const { prompter, words } = context;
  const first = await prompter.ask({
    id: "passphrase",
    message: words("passphrase.ask"),
    isSecret: true,
    check: (answer) =>
      answer.length < minPassphraseLength ? words("passphrase.short") : undefined,
  });
  const again = await prompter.ask({
    id: "passphraseAgain",
    message: words("passphrase.again"),
    isSecret: true,
  });
  if (first === again) {
    return ok(createSecret(first));
  }
  prompter.say(words("passphrase.mismatch"));
  return tries < maxTries
    ? askPassphrase(context, tries + 1)
    : refused("init.passphrase_mismatch", "refused.passphraseMismatch");
}

async function manualStore(
  context: InitContext,
  installId: Id<"ins">,
): Promise<InitStep<SecretStore>> {
  if (!context.isInteractive) {
    return refused("init.manual_needs_terminal", "refused.manualNeedsTerminal");
  }
  const passphrase = await askPassphrase(context, 1);
  if (!passphrase.ok) {
    return passphrase;
  }
  const { platform } = context;
  return ok(
    createPassphraseSecretStore({
      folder: platform.stateFolder.keys,
      installId,
      passphrase: passphrase.value,
      permissions: platform.permissions,
    }),
  );
}

const commandFlag = "--unlock-command";

/**
 * The program that prints the agent key in the `command` unlock mode, from `--unlock-command`;
 * `undefined` in every other mode, which reads no program.
 */
export function unlockCommandOf(
  context: InitContext,
  mode: UnlockMode,
): InitStep<CommandSource | undefined> {
  const text = context.flags.unlockCommand;
  if (mode !== "command") {
    return ok(undefined);
  }
  if (text === undefined) {
    return refused("init.needs_flag", "refused.needsFlag", { flag: commandFlag });
  }
  const source = sourceOf(text, commandSourceSchema);
  return source === undefined
    ? refused("init.bad_source", "refused.badSource", { flag: commandFlag })
    : ok(source);
}

// The `command` mode reads the key a secret manager holds; init never writes or prints it.
async function commandKey(
  context: InitContext,
  source: CommandSource,
): Promise<InitStep<AgentKey>> {
  const flag = commandFlag;
  const printed = await readFlagSecret(context, { flag, path: "engine.unlock.command" }, source);
  if (!printed.ok) {
    return printed;
  }
  const pair = parseAgentKey(printed.value);
  return pair.ok
    ? ok({ publicKey: pair.value.publicKey, isNew: false })
    : refused("init.agent_key_unreadable", "refused.agentKeyUnreadable", { flag });
}

async function storedKey(context: InitContext, store: SecretStore): Promise<InitStep<AgentKey>> {
  const created = await createAgentKey(store, context.signal);
  if (created.ok) {
    return ok({ publicKey: created.value.publicKey, isNew: true });
  }
  // The wallets of an earlier setup name the stored key as their signer: it is never replaced.
  const held = await openAgentKey(store, context.signal);
  return held.ok
    ? ok({ publicKey: held.value.publicKey, isNew: false })
    : refused("init.agent_key_unreadable", "refused.agentKeyUnreadable", { flag: "--unlock" });
}

/**
 * The agent key step (keys spec, section 2, step 3, and section 3): makes this machine's agent
 * key and stores it where the unlock mode reads it, the OS keychain, an owner-only file, or a
 * file sealed with a passphrase the person types twice. A key the mode holds already is kept and
 * used, never replaced. In `command` mode, with its program, the key comes from the owner's
 * secret manager.
 */
export async function takeAgentKey(
  context: InitContext,
  unlock: { readonly mode: UnlockMode; readonly command?: CommandSource },
  installId: Id<"ins">,
): Promise<InitStep<AgentKey>> {
  const { mode, command } = unlock;
  if (mode === "command") {
    return command === undefined
      ? refused("init.needs_flag", "refused.needsFlag", { flag: commandFlag })
      : commandKey(context, command);
  }
  if (mode === "manual") {
    const store = await manualStore(context, installId);
    return store.ok ? storedKey(context, store.value) : store;
  }
  return storedKey(context, secretPlaceOf(mode, context.platform).store);
}
