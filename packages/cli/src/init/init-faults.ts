import type { BinferenceError } from "@binference/core";
import type { InitRefusal } from "./init-context.js";

// The `init` message of each fault a step may throw; a fault not listed is unexpected.
const faultKeys: Readonly<Record<string, string>> = {
  "cli.prompt_cancelled": "fault.cancelled",
  "custody.privy_unreachable": "fault.privyUnreachable",
  "custody.privy_busy": "fault.privyBusy",
  "custody.privy_failed": "fault.privyFailed",
  "custody.privy_refused": "fault.privyFailed",
  "custody.privy_malformed": "fault.privyFailed",
  "custody.privy_credentials": "fault.privyFailed",
  "telegram.unreachable": "fault.telegramUnreachable",
  "telegram.flood": "fault.telegramBusy",
  "telegram.api_refused": "fault.telegramFailed",
  "telegram.api_failed": "fault.telegramFailed",
  "telegram.bad_answer": "fault.telegramFailed",
  "platform.keychain_failed": "fault.keychain",
  "platform.passphrase_rejected": "fault.passphraseRejected",
  "platform.secret_file_invalid": "fault.agentKeyInvalid",
  "signer.agent_key_invalid": "fault.agentKeyInvalid",
  "signer.agent_key_not_stored": "fault.agentKeyNotStored",
};

/**
 * What init tells the owner about a fault one of its steps threw: the message of its code, with
 * the code in it for the faults that share one message, or the unexpected-fault message. The
 * fault's own text never reaches the owner.
 */
export function initFaultOf(error: BinferenceError): InitRefusal {
  const { code } = error;
  return { code, key: faultKeys[code] ?? "fault.unexpected", values: { code } };
}
