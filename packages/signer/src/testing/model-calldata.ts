import { depositCalldata } from "./deposit-model.js";
import type { Data } from "./request-model.js";
import { approveCalldata, transferCalldata } from "./sign-fixtures.js";

const fixedCalldata: Readonly<Record<"none" | "router" | "transferFrom", string>> = {
  none: "0x",
  router: "0x7ff36ab5",
  transferFrom: `0x23b872dd${"0".repeat(192)}`,
};

/** The calldata a modelled request carries. */
export function calldata(data: Data): string {
  if (data.kind === "approve") {
    return approveCalldata(data.account, data.amount);
  }
  if (data.kind === "deposit") {
    return depositCalldata(data);
  }
  return data.kind === "transfer"
    ? transferCalldata(data.account, data.amount)
    : fixedCalldata[data.kind];
}
