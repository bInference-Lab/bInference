import { accountRefParts } from "@binference/chain";
import { jsonValueSchema } from "@binference/core";
import { displayOutsideText } from "@binference/i18n";
import { operations, type ProtocolId, type ResultOf } from "@binference/protocol";
import { z } from "zod";
import { rescueAddressOf } from "../init/rescue-step.js";
import type { LabelFlags, AgentFlags, CommonOptions } from "../program/cli-flags.schema.js";
import type { ExitCode } from "../program/cli-output.js";
import type { CommandRun } from "../program/command-run.js";
import { chooseAgent, chooseAgentFirst } from "./agent-choice.js";
import { chainName } from "./chain-name.js";
import { withEngine } from "./connect-engine.js";
import { withOwnerKey } from "./owner-key-prompt.js";

type AddressEntry = ResultOf<"address/add">;

// A label is the owner's text from any surface: cut and made visible, as cards do.
const labelLength = 64;

/** What `binference address add` was asked: the address as typed, its label and the agent. */
export interface AddressAddRequest {
  readonly options: LabelFlags;
  readonly address: string;
}

function entryValues(run: CommandRun, entry: AddressEntry) {
  const { chain, address } = accountRefParts(entry.address);
  return {
    entry: entry.entry,
    agent: entry.agent,
    label: displayOutsideText(entry.label, labelLength),
    address,
    chain: chainName(chain),
    usableAt: run.formatter.dateTime(entry.usableAt),
    createdAt: run.formatter.dateTime(entry.createdAt),
    saved: entry.inCeilingAt === undefined ? "no" : "yes",
  };
}

// An entry made since the command started is new; an older one the book held already.
function printEntry(run: CommandRun, entry: AddressEntry, startedAtMs: number): void {
  run.output.json(jsonValueSchema.parse(z.encode(operations["address/add"].result, entry)));
  const isNew = entry.createdAt >= startedAtMs;
  run.output.say(isNew ? "address.added" : "address.already", entryValues(run, entry));
}

/**
 * `binference address add <address> --label <label> [--agent <id>]`: saves an address on BNB
 * Chain that sends may pay, through `address/add` over IPC with the owner key the person types
 * unseen (spec 5, section 4). The engine lists it in the ceiling of each of the agent's wallets
 * first, then in the address book; at send level 2 a send may pay it a day after it was saved. An
 * address the book holds already is shown as it is. With `--json` it prints the entry.
 */
export async function runAddressAdd(
  run: CommandRun,
  request: AddressAddRequest,
): Promise<ExitCode> {
  const startedAtMs = run.host.clock.now();
  const typed = rescueAddressOf(request.address);
  if (typed === undefined) {
    run.output.fail({
      code: "protocol.bad_args",
      key: "address.badAddress",
      values: { address: request.address },
    });
    return 1;
  }
  const agent = await chooseAgentFirst(run, request.options.agent);
  if (!agent.ok) {
    return agent.code;
  }
  const { chain, address } = accountRefParts(typed.account);
  const saved = await withOwnerKey(run, request.options, {
    command: "address add",
    call: async (client, ownerKey, signal) =>
      client.call(
        "address/add",
        { agent: agent.value, chain, address, label: request.options.label, ownerKey },
        { signal },
      ),
  });
  if (!saved.ok) {
    return saved.code;
  }
  printEntry(run, saved.value, startedAtMs);
  return 0;
}

/**
 * `binference address list [--agent <id>]`: the agent's saved addresses through `address/list`,
 * oldest first, each with its label, its chain and from when send level 2 lets a send pay it; one
 * the ceilings do not list yet is marked. With `--json` it prints the list as the operation
 * answers it.
 */
export async function runAddressList(
  run: CommandRun,
  request: { readonly options: AgentFlags },
): Promise<ExitCode> {
  const { host, output } = run;
  return withEngine(host, output, async (client, signal) => {
    const chosen = await chooseAgent({ client, output, signal }, request.options.agent);
    if (chosen === undefined) {
      return 1;
    }
    const page = await client.call("address/list", { agent: chosen.agent }, { signal });
    output.json(jsonValueSchema.parse(z.encode(operations["address/list"].result, page)));
    output.say("address.count", { agent: chosen.agent, count: page.items.length });
    for (const entry of page.items) {
      output.item("address.item", entryValues(run, entry));
    }
    return 0;
  });
}

/**
 * `binference address remove <entry>`: takes an entry out of the address book through
 * `address/remove`, a braking change any surface with `confirm` may make: binference sends nothing
 * to it from then on. With `--json` it prints `{ entry }`.
 */
export async function runAddressRemove(
  run: CommandRun,
  request: { readonly options: CommonOptions; readonly entry: ProtocolId<"addressBook"> },
): Promise<ExitCode> {
  const { host, output } = run;
  return withEngine(host, output, async (client, signal) => {
    const { entry } = request;
    await client.call("address/remove", { entry }, { signal });
    output.json({ entry });
    output.say("address.removed", { entry });
    return 0;
  });
}
