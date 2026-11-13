import {
  type BreakerFollow,
  type BreakerLook,
  followBreaker,
  type FollowBreakerOptions,
} from "./follow-breaker.js";

/**
 * One engine's looks at the breaker (decision 0439), one at a time: a look asked while one runs
 * waits for it, then reads again. It remembers the version the last look left applied and told,
 * so a look at the same version reads no install; a look that fails forgets it.
 */
export function oneLookAtATime(
  options: FollowBreakerOptions,
): (signal: AbortSignal) => Promise<BreakerFollow> {
  const held: { known?: number; last: Promise<void> } = { last: Promise.resolve() };
  const look = async (signal: AbortSignal): Promise<BreakerFollow> => {
    const { known } = held;
    delete held.known;
    const looked: BreakerLook = await followBreaker(options, {
      signal,
      ...(known === undefined ? {} : { known }),
    });
    const settled = looked.settled ?? known;
    if (settled !== undefined) {
      held.known = settled;
    }
    return looked.follow;
  };
  return async (signal) => {
    const run = held.last.then(async () => look(signal));
    held.last = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}
