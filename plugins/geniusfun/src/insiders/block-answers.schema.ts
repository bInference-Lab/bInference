import { z } from "zod";

const quantity = z.string().regex(/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,15})$/);
const data = z.string().regex(/^0x(?:[0-9a-fA-F]{2})*$/);

/** A block's number and the second it was made in, in base units of the chain's clock. */
export interface BlockStamp {
  readonly number: bigint;
  readonly timestamp: bigint;
}

/** One log of a receipt: the contract that emitted it and its topics, as hex. */
export interface ReceiptLog {
  readonly address: string;
  readonly topics: readonly string[];
}

/** An `eth_getBlockByNumber` header, of which only the number and the time are read. */
export const blockStampSchema: z.ZodType<BlockStamp> = z
  .looseObject({ number: quantity, timestamp: quantity })
  .transform((block) => ({ number: BigInt(block.number), timestamp: BigInt(block.timestamp) }));

/** An `eth_getBlockReceipts` answer, of which only each receipt's logs are read. */
export const blockLogsSchema: z.ZodType<readonly ReceiptLog[]> = z
  .array(
    z.looseObject({
      logs: z.array(z.looseObject({ address: data, topics: z.array(data) })),
    }),
  )
  .transform((receipts) =>
    receipts.flatMap((receipt) =>
      receipt.logs.map((log) => ({ address: log.address, topics: log.topics })),
    ),
  );
