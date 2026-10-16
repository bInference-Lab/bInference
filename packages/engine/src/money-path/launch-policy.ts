import type { Amount } from "@binference/chain";
import type { LaunchTokenRequest } from "@binference/protocol";
import type { PolicySubject } from "../policy/policy-rules.js";

/**
 * What the policy judges of a token launch (decision 0234): what leaves the launch wallet, the
 * first buy and the launch fee once its launchpad quoted it, on the launchpad the request names.
 * The token is not made yet, so nothing it receives is judged.
 */
export function launchSubjectOf(
  request: LaunchTokenRequest,
  fee: Amount | undefined,
  status: Pick<PolicySubject, "kind" | "isPaper" | "hasOutsideContent">,
): PolicySubject {
  const paid = fee === undefined || fee.base === 0n ? [] : [fee];
  const bought = request.firstBuy === undefined ? [] : [request.firstBuy];
  return {
    kind: status.kind,
    isPaper: status.isPaper,
    hasOutsideContent: status.hasOutsideContent,
    outflows: [...bought, ...paid],
    inflowAssets: [],
    venue: request.venue,
  };
}
