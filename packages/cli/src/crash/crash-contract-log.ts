import { type JsonValue, jsonValueSchema } from "@binference/core";
import { type Address, getAddress, type Hex } from "viem";
import { z } from "zod";

/** Calls anvil itself, past the test's counting and kills. */
type AnvilCall = (method: string, params: readonly JsonValue[]) => Promise<JsonValue>;

/** Hex as anvil answers it, which a crash rig's answer reads. */
export const crashHexSchema: z.ZodType<Hex> = z.custom<Hex>(
  (value) => typeof value === "string" && /^0x[0-9a-f]*$/iu.test(value),
);

const receiptSchema = z
  .looseObject({
    status: z.string(),
    logs: z.array(
      z.looseObject({ address: z.string(), topics: z.array(jsonValueSchema), data: z.string() }),
    ),
  })
  .nullable();

/** One log of a contract: its topics, the event's first, and its data. */
export interface ContractLog {
  readonly topics: readonly [Hex, ...Hex[]];
  readonly data: Hex;
}

/**
 * The first log the contract wrote in the transaction as anvil mined it; none while it is unmined,
 * when it reverted, or when the contract logged nothing.
 */
export async function contractLogIn(
  anvil: AnvilCall,
  mined: { readonly hash: Hex; readonly contract: Address },
): Promise<ContractLog | undefined> {
  const receipt = receiptSchema.parse(await anvil("eth_getTransactionReceipt", [mined.hash]));
  const log = receipt?.logs.find(({ address }) => getAddress(address) === mined.contract);
  const [first, ...rest] = z.array(crashHexSchema).parse(log?.topics ?? []);
  if (receipt?.status !== "0x1" || log === undefined || first === undefined) {
    return undefined;
  }
  return { topics: [first, ...rest], data: crashHexSchema.parse(log.data) };
}
