import { err, ok } from "@binference/core";
import { ceilingViewOf } from "../ceilings/ceiling-view-of.js";
import { setCeiling, type SetCeilingOptions } from "../ceilings/set-ceiling.js";
import type { EngineHandler } from "./engine-call.js";

/** The handlers that read a wallet's ceiling and change it (protocol spec, section 7.2). */
export interface CeilingHandlers {
  readonly "ceiling/get": EngineHandler<"ceiling/get">;
  readonly "ceiling/set": EngineHandler<"ceiling/set">;
}

/**
 * What the ceiling handlers go through: the agents and the install's wallets, custody, the
 * registry, and the journal and pushes that announce a change.
 */
export type CeilingHandlersOptions = SetCeilingOptions;

/**
 * Creates the ceiling handlers. `ceiling/get` answers a wallet's ceiling as custody holds it now,
 * read on each call. Its venues are those whose every registry contract, on the chains the
 * ceiling enables, a call may reach. A wallet the install does not hold, or whose ceiling custody
 * does not hold, is `wallet.not_found`; while the engine is locked, custody answers
 * `wallet.custody_down`. `ceiling/set` changes the venues and cap of every live wallet of the
 * wallet's agent with the owner key, as `setCeiling` decides (decision 0132).
 */
export function createCeilingHandlers(options: CeilingHandlersOptions): CeilingHandlers {
  return {
    async "ceiling/get"({ args, signal }) {
      const { wallets } = await options.install.read({ signal });
      const wallet = wallets.find((item) => item.id === args.wallet);
      const read =
        wallet === undefined ? undefined : await options.ceilings.read(wallet.policyId, { signal });
      if (wallet === undefined || read?.ok !== true) {
        return err("wallet.not_found");
      }
      const held = { wallet: wallet.id, read: read.value, readAt: options.clock.now() };
      return ok(ceilingViewOf(options.chains, held));
    },
    "ceiling/set": async (call) => setCeiling(options, call),
  };
}
