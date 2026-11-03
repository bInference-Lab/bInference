import type { ChainRegistry } from "@binference/chain";
import { err, ok } from "@binference/core";
import type { RegisterIdentityRequest } from "@binference/protocol";
import type { DestinationChain } from "../address-book/destination-chain.js";
import type { MoneyPath } from "../money-path/create-money-path.js";
import { type EngineHandler, proposerOf } from "../operations/engine-call.js";
import { intentViewOf } from "../operations/intent-view-of.js";
import type { AgentStore } from "../ports.js";
import type { IdentityStore } from "./ports.js";

/** The handlers of the identity operations the engine serves (protocol spec, section 7.9). */
export interface IdentityHandlers {
  readonly "identity/get": EngineHandler<"identity/get">;
  readonly "identity/register": EngineHandler<"identity/register">;
}

/** What the identity handlers read and propose through. */
export interface IdentityHandlersOptions {
  readonly moneyPath: MoneyPath;
  readonly identities: IdentityStore;
  readonly agents: Pick<AgentStore, "get">;
  readonly chains: ChainRegistry;
  readonly destinations?: readonly DestinationChain[];
}

/**
 * Creates the identity handlers (decision 0335): `identity/get` answers the agent's identity as
 * binference stored it, with its registration file, or none; `identity/register` proposes the
 * owner's registration with the description given and answers with its intent once it waits for
 * the tap or ends. A proposal of the agent runtime or an MCP client is `intent.owner_only`.
 */
export function createIdentityHandlers(options: IdentityHandlersOptions): IdentityHandlers {
  return {
    "identity/get": async ({ args, signal }) => {
      if ((await options.agents.get(args.agent, { signal })) === undefined) {
        return err("agent.not_found");
      }
      const stored = await options.identities.get(args.agent, { signal });
      if (stored === undefined) {
        return ok({});
      }
      const { registry, onchainId, txHash, registeredAtMs, file } = stored;
      return ok({
        registration: { registry, onchainId, txHash, registeredAt: registeredAtMs, file },
      });
    },
    "identity/register": async ({ args, caller, signal }) => {
      const proposer = proposerOf(caller);
      if (proposer === undefined) {
        return err("auth.scope");
      }
      // The owner asks for it, so the request carries the operation's name where an agent's reason goes;
      // its card shows no reason.
      const base: RegisterIdentityRequest = {
        kind: "registerIdentity",
        agent: args.agent,
        reason: "identity/register",
      };
      const { description } = args;
      const request = description === undefined ? base : { ...base, description };
      const proposed = await options.moneyPath.propose(request, proposer, {
        signal,
        credential: caller.credential,
      });
      if (!proposed.ok) {
        return proposed;
      }
      const reads = { destinations: options.destinations };
      return ok(intentViewOf(proposed.value, options.chains, reads));
    },
  };
}
