import { type Address, zeroAddress } from "viem";
import {
  launchCallData,
  launchFactoryCallData,
  launchFactoryOf,
  type LaunchRecord,
  launchRecordOf,
} from "../contracts/genius-calls.js";
import { type GeniusRead, readCall, readOptional, unreadable } from "../contracts/read-genius.js";
import type { StackFactory } from "../geniusfun-contracts.js";

/** Where a token was launched, as the registry's stacks and the token itself tell it. */
export type LaunchFinding =
  | {
      readonly kind: "launched";
      /** The stack whose factory made the token. */
      readonly stack: StackFactory;
      readonly launch: LaunchRecord;
    }
  | {
      /**
       * A factory the registry does not list says it made the token: a stack the venue does not
       * know, whose curve it never trades.
       */
      readonly kind: "unknown_stack";
      readonly factory: Address;
      /** What that factory says the token's curve trades against; the zero address for the coin. */
      readonly pairToken: Address;
      /** The phase that factory says the launch is in, one of `launchPhase`. */
      readonly phase: number;
    }
  | { readonly kind: "not_launched" };

const notLaunched: LaunchFinding = { kind: "not_launched" };

// A token no listed stack made: its own `launchFactory()` may name a factory the registry does
// not list, which is believed only when that factory also says it made the token.
async function unknownStackOf(
  read: GeniusRead,
  factories: readonly StackFactory[],
  token: Address,
): Promise<LaunchFinding> {
  const factory = await readOptional(
    read,
    { to: token, data: launchFactoryCallData },
    launchFactoryOf,
  );
  const isListed = factories.some((stack) => stack.address === factory);
  if (factory === undefined || factory === zeroAddress || isListed) {
    return notLaunched;
  }
  const launch = await readOptional(
    read,
    { to: factory, data: launchCallData(token) },
    launchRecordOf,
  );
  return launch?.exists === true && launch.token === token
    ? { kind: "unknown_stack", factory, pairToken: launch.pairToken, phase: launch.phase }
    : notLaunched;
}

/**
 * Finds a token's launch across Genius.fun's live stacks at the latest block: every stack's
 * factory is asked for its record of the token (`getLaunchedToken`), all at once, and the one
 * that made it gives its record, its curve among it. When none did, the token's own
 * `launchFactory()` is read: a factory the registry does not list that says it made the token is
 * an `unknown_stack`; any other answer, or none, is `not_launched`. Two stacks that both claim the
 * token, or a record outside its shape or for another token, is a fault (`geniusfun.read_failed`).
 * Rejects when no node answers, and with the signal's reason once it aborts.
 */
export async function findLaunch(
  read: GeniusRead,
  factories: readonly StackFactory[],
  token: Address,
): Promise<LaunchFinding> {
  const records = await Promise.all(
    factories.map(async (stack) => {
      const asked = {
        to: stack.address,
        data: launchCallData(token),
        what: `${stack.name}'s record`,
      };
      return { stack, launch: await readCall(read, asked, launchRecordOf) };
    }),
  );
  const made = records.filter(({ launch }) => launch.exists);
  const [found, second] = made;
  if (second !== undefined || (found !== undefined && found.launch.token !== token)) {
    throw unreadable("the stacks' records of the token disagree.");
  }
  return found === undefined
    ? unknownStackOf(read, factories, token)
    : { kind: "launched", stack: found.stack, launch: found.launch };
}
