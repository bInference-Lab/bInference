import { rescueAddressOf } from "../init/rescue-step.js";
import type { CommonOptions } from "../program/cli-flags.schema.js";
import type { ExitCode } from "../program/cli-output.js";
import type { CommandRun } from "../program/command-run.js";
import { withOwnerKey } from "./owner-key-prompt.js";

/** What `binference rescue set` was asked: the new rescue address as typed. */
export interface RescueSetRequest {
  readonly options: CommonOptions;
  readonly address: string;
}

/**
 * `binference rescue set <address>`: asks the engine over IPC to make the address on BNB Chain
 * the new rescue address (decision 0110), with the owner key the person types unseen. The engine
 * saves the address in every ceiling and makes it take effect 24 hours later; the command says
 * when. Exits 1 when the address is no address on BNB Chain, or the owner key is wrong three
 * times.
 */
export async function runRescueSet(run: CommandRun, request: RescueSetRequest): Promise<ExitCode> {
  const rescue = rescueAddressOf(request.address);
  if (rescue === undefined) {
    run.output.fail({
      code: "protocol.bad_args",
      key: "rescue.badAddress",
      values: { address: request.address },
    });
    return 1;
  }
  const set = await withOwnerKey(run, request.options, {
    command: "rescue set",
    call: async (client, ownerKey, signal) =>
      client.call("safety/setRescueAddress", { address: rescue.account, ownerKey }, { signal }),
  });
  if (!set.ok) {
    return set.code;
  }
  const { effectiveAt } = set.value;
  const isNow = effectiveAt <= run.host.clock.now();
  run.output.say(isNow ? "rescue.current" : "rescue.set", {
    address: rescue.address,
    when: run.formatter.dateTime(effectiveAt),
  });
  return 0;
}
