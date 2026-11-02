import { isSameAccount } from "@binference/chain";
import type { ReasonNamed } from "../intents/event-cause.schema.js";
import type { StakeRun } from "./stake-steps.js";

/**
 * What a staking move's refusal before its card names: the facts its venue's refusal gave, and on
 * a liquid venue its pool, by the name the venue's options give where they answer, since its
 * request names no validator and no plan stored one (decision 0331).
 */
export async function refusalNamedOf(
  run: Pick<StakeRun, "parts" | "advance" | "resolved" | "planned">,
): Promise<ReasonNamed | undefined> {
  const { parts, advance, resolved, planned } = run;
  const facts = planned.ok ? undefined : planned.facts;
  const { pool } = resolved.venue;
  if (pool === undefined) {
    return facts;
  }
  const options = await parts.staking.options(resolved.venue, { signal: advance.signal });
  const listed = options.ok ? options.value.validators : [];
  const name = listed.find(({ validator }) =>
    isSameAccount(validator, pool, resolved.chain.family),
  )?.name;
  return { ...facts, pool: { account: pool, ...(name === undefined ? {} : { name }) } };
}
