import type { MoneyPath } from "../money-path/create-money-path.js";
import { proposeTransfer, type TransferPathOptions } from "./propose-transfer.js";

/**
 * The money path with the path of sends and approval revokes (spec 6, section 5): a `send` or a
 * `revokeApproval` request takes it, and every other request, a fill among them, the money path's.
 */
export function withTransfers(path: MoneyPath, options: TransferPathOptions): MoneyPath {
  return {
    propose: async (request, proposer, call) => {
      const isTransfer = request.kind === "send" || request.kind === "revokeApproval";
      return isTransfer && call.fill === undefined
        ? proposeTransfer(options, { request, proposer }, call.signal)
        : path.propose(request, proposer, call);
    },
  };
}
