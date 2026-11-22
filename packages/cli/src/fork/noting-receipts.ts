import type { ReceiptReader } from "@binference/chain";

/**
 * A receipt reader that notes the latest block of each head it reads, then answers as `reader`
 * does: a fork test waits on the notes to know that a sent step's watch has read the head, which
 * its stuck rules count blocks from.
 */
export function notingReceipts(reader: ReceiptReader, heads: bigint[]): ReceiptReader {
  return {
    ...reader,
    async head(chain, call) {
      const head = await reader.head(chain, call);
      heads.push(head.latest);
      return head;
    },
  };
}
