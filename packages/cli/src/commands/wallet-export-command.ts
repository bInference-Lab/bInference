import { accountRefParts } from "@binference/chain";
import { BinferenceError } from "@binference/core";
import { displayOutsideText } from "@binference/i18n";
import type { WalletView } from "@binference/protocol";
import { createKeyRecipient } from "../export/key-recipient.js";
import type { WalletAddressFlags } from "../program/cli-flags.schema.js";
import type { ExitCode } from "../program/cli-output.js";
import type { CommandRun } from "../program/command-run.js";
import type { Prompter } from "../term/prompter.js";
import { withEngine } from "./connect-engine.js";
import { cannotAskOwnerKey, type OwnerKeyOutcome, withOwnerKey } from "./owner-key-prompt.js";
import { chooseWallet } from "./wallet-choice.js";

const command = "wallet export";
// A label is the owner's text from any surface: cut and made visible, as cards do.
const labelLength = 64;
// The characters of the address the owner types back.
const endLength = 4;
// A private key's text is short: an EVM key is 66 characters.
const maxKeyText = 256;

// The wallet `--agent` or `--wallet` names; the exit code after a refusal it printed.
async function walletOf(
  run: CommandRun,
  options: WalletAddressFlags,
): Promise<OwnerKeyOutcome<WalletView>> {
  const chosen: { wallet?: WalletView } = {};
  const code = await withEngine(run.host, run.output, async (client, signal) => {
    const wallet = await chooseWallet({ client, output: run.output, signal }, options);
    if (wallet === undefined) {
      return 1;
    }
    chosen.wallet = wallet;
    return 0;
  });
  return chosen.wallet === undefined ? { ok: false, code } : { ok: true, value: chosen.wallet };
}

// The warning, then the address's last characters typed back; a wrong answer asks again.
async function confirmExport(run: CommandRun, prompter: Prompter, address: string): Promise<void> {
  const end = address.slice(-endLength).toLowerCase();
  const message = (key: string): string => run.formatter.message(`cli.${key}`, { address });
  prompter.note(message("walletExport.warning"), message("walletExport.warningTitle"));
  await prompter.ask({
    id: "addressEnd",
    message: message("walletExport.ask"),
    check: (answer) =>
      answer.trim().toLowerCase() === end ? undefined : message("walletExport.wrongEnd"),
  });
}

// The opened key as text: printable, and as short as a key is; anything else is a fault.
function keyText(opened: Uint8Array): string {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(opened);
  if (text.length === 0 || text.length > maxKeyText || !/^[\x21-\x7e]+$/u.test(text)) {
    throw new BinferenceError({
      code: "cli.export_unreadable",
      message: "The exported key opened to text that is no private key.",
    });
  }
  return text;
}

/**
 * `binference wallet export [--agent <id>] [--wallet <id>]`: shows the private key of the agent's
 * default wallet, or of the wallet `--wallet` names, once (decision 0131). It warns that anyone
 * with the key controls every token in the wallet, and asks the person to type the address's last
 * 4 characters. It then makes a fresh HPKE recipient key, asks for the owner key unseen and calls
 * `wallet/exportSealed` over IPC with the recipient key's public half alone; custody seals the
 * wallet's key to it, and only this process opens it. The key is printed once and its bytes are
 * zeroed; nothing keeps it. With `--yes`, `--json` or nobody at the terminal it reads nothing.
 */
export async function runWalletExport(
  run: CommandRun,
  request: { readonly options: WalletAddressFlags },
): Promise<ExitCode> {
  const { options } = request;
  const { prompter } = run.host;
  if (cannotAskOwnerKey(run, options, command) || prompter === undefined) {
    return 1;
  }
  const chosen = await walletOf(run, options);
  if (!chosen.ok) {
    return chosen.code;
  }
  const wallet = chosen.value;
  const { address } = accountRefParts(wallet.address);
  await confirmExport(run, prompter, address);
  const recipient = await createKeyRecipient();
  const sealed = await withOwnerKey(run, options, {
    command,
    call: async (client, ownerKey, signal) =>
      client.call(
        "wallet/exportSealed",
        { wallet: wallet.wallet, recipientPublicKey: recipient.publicKey, ownerKey },
        { signal },
      ),
  });
  if (!sealed.ok) {
    return sealed.code;
  }
  const opened = await recipient.open(sealed.value);
  try {
    const label = displayOutsideText(wallet.label, labelLength);
    run.output.say("walletExport.shown", { label, address });
    run.output.line(keyText(opened));
    run.output.say("walletExport.after");
  } finally {
    opened.fill(0);
  }
  return 0;
}
