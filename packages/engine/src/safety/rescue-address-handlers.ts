import type { AccountRef } from "@binference/chain";
import { createSecret, err, jsonValueSchema, ok, type Result, type Secret } from "@binference/core";
import type { ProtocolErrorCode } from "@binference/protocol";
import { payeeRefusal } from "../address-book/payee-refusal.js";
import { authorOf, journalConfigChange } from "../audit/journal-config-change.js";
import { readCeilings, refreshCeilings } from "../ceilings/ceiling-rewrite.js";
import type { RescueMove } from "../install/rescue-record.js";
import { canonicalAccount } from "../operations/canonical-account.js";
import type { EngineCall, EngineHandler } from "../operations/engine-call.js";
import { changeRescue, type RescueState, rescueAt } from "../policy/rescue-change.js";
import type { ConfigJournal } from "../ports.js";
import { rescueAddressNotice, rescueCancelledNotice } from "./rescue-address-notice.js";
import {
  moveRescueCeilings,
  type RescueCeilingsOptions,
  sendCancelCeilings,
  serially,
  settleRescueCeilings,
} from "./rescue-ceilings.js";
import { checkRescueReach, withCheckedReach } from "./rescue-check.js";
import { announceEachAgent } from "./rescue-joins.js";
import { keepCheckedReach } from "./rescue-keep.js";

/** The handlers of the install's rescue address change (protocol spec, section 7.1). */
export interface RescueAddressHandlers {
  readonly "safety/setRescueAddress": EngineHandler<"safety/setRescueAddress">;
  readonly "safety/cancelRescueChange": EngineHandler<"safety/cancelRescueChange">;
}

/** What the rescue address handlers read, write and announce through. */
export interface RescueAddressHandlersOptions extends RescueCeilingsOptions {
  readonly journal: ConfigJournal;
}

type RescueCall = EngineCall<"safety/setRescueAddress"> | EngineCall<"safety/cancelRescueChange">;

function isSame(a: RescueState, b: RescueState): boolean {
  return (
    a.rescueAddress === b.rescueAddress &&
    a.pendingRescue?.address === b.pendingRescue?.address &&
    a.pendingRescue?.atMs === b.pendingRescue?.atMs
  );
}

// A change is journaled with who made it and where, and pushed on the config topic; a new
// address that starts to wait, and one dropped before its time, are announced on every surface.
async function record(
  options: RescueAddressHandlersOptions,
  call: RescueCall,
  { before, after }: RescueMove,
): Promise<void> {
  if (isSame(before, after)) {
    return;
  }
  const { pendingRescue } = after;
  const waited = before.pendingRescue;
  const starts = pendingRescue !== undefined && pendingRescue.atMs !== waited?.atMs;
  const isDropped = waited !== undefined && pendingRescue === undefined;
  await journalConfigChange(
    options,
    {
      author: authorOf(call.caller),
      atMs: options.clock.now(),
      path: "safety.rescueAddress",
      before: jsonValueSchema.parse(before),
      after: jsonValueSchema.parse(after),
      notices: [
        ...(starts ? [rescueAddressNotice(pendingRescue)] : []),
        ...(isDropped ? [rescueCancelledNotice(waited)] : []),
      ],
    },
    { signal: call.signal },
  );
}

// The owner key travels only over IPC (decision 0110); version 1 keeps it optional in the schema.
function ownerKeyOf(
  call: EngineCall<"safety/setRescueAddress">,
): Result<Secret, ProtocolErrorCode> {
  if (call.caller.transport !== "ipc") {
    return err("auth.local_only");
  }
  const { ownerKey } = call.args;
  return ownerKey === undefined ? err("wallet.bad_owner_key") : ok(createSecret(ownerKey));
}

// The new address in every live wallet's ceiling, the rescue addresses checked for every agent on
// the destinations its rules serve, as the change leaves them (decision 0321), the change stored
// and journaled, then each ceiling read back, the standings custody holds kept, and each agent's
// rewrite announced.
async function writeRescue(
  options: RescueAddressHandlersOptions,
  call: EngineCall<"safety/setRescueAddress">,
  asked: { readonly address: AccountRef; readonly ownerKey: Secret; readonly isNew: boolean },
): Promise<Result<void, ProtocolErrorCode>> {
  const { signal } = call;
  const { address, ownerKey, isNew } = asked;
  const held = await options.install.read({ signal });
  const atMs = options.clock.now();
  const next = changeRescue(held, address, atMs);
  const wallets = held.wallets.filter((wallet) => wallet.archivedAtMs === undefined);
  const agents = [...new Set(wallets.map((wallet) => wallet.agentId))];
  const plan = { agents, rescue: next, ...(isNew ? { fresh: address } : {}) };
  const checked = await checkRescueReach(options, plan, signal);
  const facts = withCheckedReach(held, checked);
  const before = await readCeilings(options, wallets, signal);
  const ceiling = await moveRescueCeilings(options, { facts, next, ownerKey, signal });
  if (!ceiling.ok) {
    return ceiling;
  }
  const kept = ceiling.value === undefined ? {} : { ceiling: ceiling.value };
  const change = { address, atMs, ...kept };
  await record(options, call, await options.install.changeRescue(change, { signal }));
  const after = await refreshCeilings(options, wallets, signal);
  const notices = await keepCheckedReach(options, checked, { after, signal });
  await announceEachAgent(
    options,
    { author: authorOf(call.caller), signal, notices },
    {
      before,
      after,
    },
  );
  return ok(undefined);
}

async function setRescue(
  options: RescueAddressHandlersOptions,
  call: EngineCall<"safety/setRescueAddress">,
): Promise<Result<{ readonly effectiveAt: number }, ProtocolErrorCode>> {
  const ownerKey = ownerKeyOf(call);
  const address = canonicalAccount(options.chains, call.args.address);
  if (!ownerKey.ok) {
    return ownerKey;
  }
  if (!address.ok) {
    return address;
  }
  const { signal } = call;
  const { wallets } = await options.install.read({ signal });
  const refusal = payeeRefusal(wallets, address.value, options.chains);
  if (refusal !== undefined) {
    return err(refusal);
  }
  return serially(options.install, async () => {
    await settleRescueCeilings(options, signal);
    const facts = await options.install.read({ signal });
    const atMs = options.clock.now();
    const held = rescueAt(facts, atMs);
    const next = changeRescue(facts, address.value, atMs);
    const effectiveAt =
      next.pendingRescue?.address === address.value ? next.pendingRescue.atMs : atMs;
    if (isSame(next, held)) {
      return ok({ effectiveAt });
    }
    const isNew = address.value !== held.rescueAddress;
    const asked = { address: address.value, ownerKey: ownerKey.value, isNew };
    const written = await writeRescue(options, call, asked);
    return written.ok ? ok({ effectiveAt }) : written;
  });
}

async function cancelChange(
  options: RescueAddressHandlersOptions,
  call: EngineCall<"safety/cancelRescueChange">,
): Promise<void> {
  const { signal } = call;
  await settleRescueCeilings(options, signal);
  const cancel = await options.install.cancelRescueChange(options.clock.now(), { signal });
  await record(options, call, cancel);
  const dropped = cancel.before.pendingRescue;
  if (dropped !== undefined && cancel.after.pendingRescue === undefined) {
    await sendCancelCeilings(
      options,
      {
        address: dropped.address,
        ...(cancel.dropped === undefined ? {} : { ceiling: cancel.dropped }),
      },
      signal,
    );
  }
}

/**
 * Creates the rescue address handlers (decisions 0044 and 0110). `safety/setRescueAddress` takes
 * the owner key over IPC only: it saves the new address in every wallet's ceiling at once, beside
 * the address in effect, and signs ahead the change that leaves the old address out once the new
 * one takes effect 24 hours later, and the one that leaves the new address out if it is
 * cancelled. First it runs, for every agent, the plain-wallet check of the new address on each
 * destination the agent's bridge rules serve, and of the address in effect where its standing does
 * not list it, so the rules there list each rescue address where it passed; each ceiling is then
 * read back, and each agent whose standings changed is told: a waiting address with the time a
 * bridge may pay it (decision 0321). It runs in the install's line of owner key writes. The new address is announced with its time; asking for the address in effect drops
 * one that waits and answers now. An address on a chain the registry lacks, or one its family
 * cannot read, is `protocol.bad_args`; a launch wallet of the install, which no ceiling may list,
 * `address.launch_wallet` (decision 0218), a bridge wallet `address.bridge_wallet` and a contract the
 * registry lists for a venue `address.venue_contract` (decision 0307); a missing or wrong owner key `wallet.bad_owner_key`; a
 * call over WS `auth.local_only`. `safety/cancelRescueChange` drops the address that waits and sends
 * the change that leaves it out of the ceilings. Each change is journaled, pushed as
 * `config/changed` and announced. Both first send a change whose time has come.
 */
export function createRescueAddressHandlers(
  options: RescueAddressHandlersOptions,
): RescueAddressHandlers {
  return {
    "safety/setRescueAddress": async (call) => setRescue(options, call),
    async "safety/cancelRescueChange"(call) {
      await cancelChange(options, call);
      return ok({});
    },
  };
}
