import {
  type AccountRef,
  accountRefParts,
  accountRefSchema,
  type ChainRegistry,
} from "@binference/chain";
import { type Clock, err, jsonValueSchema, ok, type Result } from "@binference/core";
import type { ProtocolErrorCode } from "@binference/protocol";
import type { RescueMove } from "../install/rescue-record.js";
import { answererOf, type EngineCall, type EngineHandler } from "../operations/engine-call.js";
import type { RescueState } from "../policy/rescue-change.js";
import type { ConfigJournal, InstallStore } from "../ports.js";
import type { PublishPush } from "../pushes/engine-push.js";
import { rescueAddressNotice } from "./rescue-address-notice.js";

/** The handlers of the install's rescue address change (protocol spec, section 7.1). */
export interface RescueAddressHandlers {
  readonly "safety/setRescueAddress": EngineHandler<"safety/setRescueAddress">;
  readonly "safety/cancelRescueChange": EngineHandler<"safety/cancelRescueChange">;
}

/** What the rescue address handlers read, write and announce through. */
export interface RescueAddressHandlersOptions {
  readonly install: InstallStore;
  readonly chains: ChainRegistry;
  readonly journal: ConfigJournal;
  readonly clock: Clock;
  readonly publish: PublishPush;
}

type RescueCall = EngineCall<"safety/setRescueAddress"> | EngineCall<"safety/cancelRescueChange">;

// The address in its family's canonical form, on a chain the registry holds.
function canonicalOf(
  chains: ChainRegistry,
  account: AccountRef,
): Result<AccountRef, ProtocolErrorCode> {
  const { chain, address } = accountRefParts(account);
  const registered = chains.get(chain);
  const parsed = registered.ok ? registered.value.family.parseAddress(address) : undefined;
  return parsed?.ok === true
    ? ok(accountRefSchema.parse(`${chain}:${parsed.value}`))
    : err("protocol.bad_args");
}

function isSame(a: RescueState, b: RescueState): boolean {
  return (
    a.rescueAddress === b.rescueAddress &&
    a.pendingRescue?.address === b.pendingRescue?.address &&
    a.pendingRescue?.atMs === b.pendingRescue?.atMs
  );
}

// A change is journaled with who made it and where, and pushed on the config topic; a new
// address that starts to wait is announced to the owner on every surface.
async function record(
  options: RescueAddressHandlersOptions,
  call: RescueCall,
  { before, after }: RescueMove,
): Promise<void> {
  if (isSame(before, after)) {
    return;
  }
  const entry = await options.journal.record(
    {
      atMs: options.clock.now(),
      by: call.caller.credential,
      surface: answererOf(call.caller).surface,
      path: "safety.rescueAddress",
      before: jsonValueSchema.parse(before),
      after: jsonValueSchema.parse(after),
    },
    { signal: call.signal },
  );
  options.publish({ topic: "config", kind: "config/changed", data: jsonValueSchema.parse(entry) });
  const { pendingRescue } = after;
  if (pendingRescue !== undefined && pendingRescue.atMs !== before.pendingRescue?.atMs) {
    options.publish(rescueAddressNotice(pendingRescue));
  }
}

/**
 * Creates the rescue address handlers (decision 0044). `safety/setRescueAddress` makes a new
 * address wait 24 hours before a rescue pays it, announced on every surface with the time it
 * takes effect, and answers that time; asking for the address in effect drops one that waits and
 * answers now. An address on a chain the registry lacks, or one its family cannot read, is
 * `protocol.bad_args`. `safety/cancelRescueChange` drops the address that waits, and the address
 * in effect stays. Each change is journaled and pushed as `config/changed`. A rescue to the new
 * address also needs it in each wallet's ceiling, which only the owner key changes.
 */
export function createRescueAddressHandlers(
  options: RescueAddressHandlersOptions,
): RescueAddressHandlers {
  return {
    async "safety/setRescueAddress"(call) {
      const address = canonicalOf(options.chains, call.args.address);
      if (!address.ok) {
        return address;
      }
      const atMs = options.clock.now();
      const move = await options.install.changeRescue(
        { address: address.value, atMs },
        { signal: call.signal },
      );
      await record(options, call, move);
      const { pendingRescue } = move.after;
      return ok({
        effectiveAt: pendingRescue?.address === address.value ? pendingRescue.atMs : atMs,
      });
    },
    async "safety/cancelRescueChange"(call) {
      const move = await options.install.cancelRescueChange(options.clock.now(), {
        signal: call.signal,
      });
      await record(options, call, move);
      return ok({});
    },
  };
}
