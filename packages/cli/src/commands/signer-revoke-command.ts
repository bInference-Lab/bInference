import type { CommonOptions } from "../program/cli-flags.schema.js";
import type { ExitCode } from "../program/cli-output.js";
import type { CommandRun } from "../program/command-run.js";
import { withOwnerKey } from "./owner-key-prompt.js";

/** What `binference signer revoke` was asked for. */
export interface SignerRevokeRequest {
  readonly options: CommonOptions;
  /** The signer ID: the key quorum of the machine's agent key. */
  readonly signer: string;
}

/**
 * `binference signer revoke <signer>`: asks for the owner key unseen and calls `signer/revoke`
 * over IPC, which removes the machine's agent key from every live wallet (decision 0140). It then
 * says that the machine signs nothing more, and that its background service starts it again at
 * its next login, locked and without the bot, until the owner stops it there. The engine refuses
 * its own key, a signer no wallet lists and a wallet's last signer, and changes nothing then.
 * With `--json` it prints `{ signer }`.
 */
export async function runSignerRevoke(
  run: CommandRun,
  request: SignerRevokeRequest,
): Promise<ExitCode> {
  const { signer } = request;
  const revoked = await withOwnerKey(run, request.options, {
    command: "signer revoke",
    call: async (client, ownerKey, signal) =>
      client.call("signer/revoke", { signer, ownerKey }, { signal }),
  });
  if (!revoked.ok) {
    return revoked.code;
  }
  run.output.json({ signer });
  run.output.say("signerRevoke.done", { signer });
  return 0;
}
