import { accountRefParts, type ChainRef, chainRefSchema } from "@binference/chain";
import { jsonValueSchema } from "@binference/core";
import { displayOutsideText } from "@binference/i18n";
import { operations, type ProtocolId, type ResultOf } from "@binference/protocol";
import { z } from "zod";
import { selfHostedChains } from "../compose/open-engine-parts.js";
import { selfHostedFamilies } from "../compose/self-hosted-destinations.js";
import type { AddressAddFlags, AgentFlags, CommonOptions } from "../program/cli-flags.schema.js";
import type { ExitCode } from "../program/cli-output.js";
import type { CommandRun } from "../program/command-run.js";
import { addressChainOf, addressChains } from "./address-chain.js";
import { chooseAgentFirst, withAgent } from "./agent-choice.js";
import { chainName } from "./chain-name.js";
import { withEngine } from "./connect-engine.js";
import { withOwnerKey } from "./owner-key-prompt.js";

type AddressEntry = ResultOf<"address/add">;

// A label is the owner's text from any surface: cut and made visible, as cards do.
const labelLength = 64;

/** What `binference address add` was asked: the address as typed, its label, chain and agent. */
export interface AddressAddRequest {
  readonly options: AddressAddFlags;
  readonly address: string;
}

// Whether a ceiling lists the entry: not yet, not on any route of a bridge, or yes.
function savedMark(entry: AddressEntry): "no" | "noRoute" | "yes" {
  if (entry.noRoute === true) {
    return "noRoute";
  }
  return entry.inCeilingAt === undefined ? "no" : "yes";
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
    saved: savedMark(entry),
  };
}

// What a new entry's answer says: a send pays it on a chain the wallets trade on, a bridge to it
// on any other, and nothing yet where no bridge route reaches its chain.
function addedKey(entry: AddressEntry): string {
  if (selfHostedChains().get(accountRefParts(entry.address).chain).ok) {
    return "address.added";
  }
  return entry.noRoute === true ? "address.addedNoRoute" : "address.addedElsewhere";
}

// An entry made since the command started is new; an older one the book held already.
function printEntry(run: CommandRun, entry: AddressEntry, startedAtMs: number): void {
  run.output.json(jsonValueSchema.parse(z.encode(operations["address/add"].result, entry)));
  const added = addedKey(entry);
  run.output.say(
    entry.createdAt >= startedAtMs ? added : "address.already",
    entryValues(run, entry),
  );
}

// The address typed, on the chain `--chain` names, as its family's codec reads it; a chain the
// address book does not save on, an address of another family or other text the codec refuses
// fails before the owner key is asked, with the reason the engine would give.
function typedAccount(
  run: CommandRun,
  request: AddressAddRequest,
): { readonly chain: ChainRef; readonly address: string } | undefined {
  const definition = addressChainOf(request.options.chain);
  if (definition === undefined) {
    const chains = addressChains()
      .map((chain) => chain.key)
      .join(", ");
    const values = { chain: request.options.chain ?? "", chains };
    run.output.fail({ code: "address.unknown_chain", key: "address.badChain", values });
    return undefined;
  }
  const chain = chainRefSchema.parse(definition.id);
  const families = selfHostedFamilies();
  const codec = families.codecOf(chain);
  const typed = request.address.trim();
  const parsed = codec.ok ? codec.value.parse(typed) : undefined;
  if (parsed?.ok === true) {
    return { chain, address: parsed.value };
  }
  const namespace = codec.ok ? codec.value.namespace : undefined;
  const elsewhere = families.codecs.some(
    (other) => other.namespace !== namespace && other.parse(typed).ok,
  );
  const values = { address: request.address, chain: definition.name };
  run.output.fail(
    elsewhere
      ? { code: "address.other_chain", key: "address.otherChain", values }
      : { code: "address.malformed", key: "address.badAddress", values },
  );
  return undefined;
}

/**
 * `binference address add <address> --label <label> [--chain <key>] [--agent <id>]`: saves an
 * address on the chain `--chain` names by its registry key, BNB Smart Chain when left out, through
 * `address/add` over IPC with the owner key the person types unseen (spec 5, section 4; decision
 * 0313). On a chain the wallets trade on a send may pay it; on a chain a bridge delivers to, such
 * as Base or Solana, only a bridge there. The engine lists it in the ceiling of each of the
 * agent's wallets first, then in the address book; at send level 2 it may be paid a day after it
 * was saved. An address the book holds already is shown as it is. With `--json` it prints the
 * entry.
 */
export async function runAddressAdd(
  run: CommandRun,
  request: AddressAddRequest,
): Promise<ExitCode> {
  const startedAtMs = run.host.clock.now();
  const typed = typedAccount(run, request);
  if (typed === undefined) {
    return 1;
  }
  const agent = await chooseAgentFirst(run, request.options.agent);
  if (!agent.ok) {
    return agent.code;
  }
  const { chain, address } = typed;
  const saved = await withOwnerKey(run, request.options, {
    command: "address add",
    call: async (client, ownerKey, signal) =>
      client.call(
        "address/add",
        { agent: agent.value.agent, chain, address, label: request.options.label, ownerKey },
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
 * the ceilings do not list yet is marked. Then, for each chain other than the wallets' it saved an
 * address for, the room left there (decision 0314). With `--json` it prints the list as the
 * operation answers it.
 */
export async function runAddressList(
  run: CommandRun,
  request: { readonly options: AgentFlags },
): Promise<ExitCode> {
  const { output } = run;
  return withAgent(run, request.options.agent, async (client, agent, signal) => {
    const page = await client.call("address/list", { agent }, { signal });
    output.json(jsonValueSchema.parse(z.encode(operations["address/list"].result, page)));
    output.say("address.count", { agent, count: page.items.length });
    for (const entry of page.items) {
      output.item("address.item", entryValues(run, entry));
    }
    for (const room of page.room ?? []) {
      output.say("address.room", {
        used: room.used,
        most: room.most,
        chain: chainName(room.chain),
      });
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
