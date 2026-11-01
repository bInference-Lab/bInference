import { accountRefSchema, assetRefSchema, chainRefSchema } from "@binference/chain";
import { describe, expect, it } from "vitest";
import type { SolanaChain } from "../solana-chain.js";
import { solanaLogEvents } from "./solana-log-events.js";

const chain: SolanaChain = {
  ref: chainRefSchema.parse("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"),
  name: "Solana",
  nativeAsset: assetRefSchema.parse("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp/slip44:501"),
};
const program = (id: string) => accountRefSchema.parse(`${chain.ref}:${id}`);
const memo = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
const spoke = "DLv3NggMiSaef97YCkew5xKUHDh13tVGZ7tydt3ZeAru";
const token = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

describe("a Solana transaction's events", () => {
  it("reads each program's log and data lines as its events, and none of the runtime's", () => {
    const lines = [
      `Program ${memo} invoke [1]`,
      'Program log: Memo (len 66): "0xe74b"',
      `Program ${memo} consumed 24927 of 62224 compute units`,
      `Program ${memo} success`,
      `Program ${spoke} invoke [1]`,
      `Program ${token} invoke [2]`,
      "Program log: Instruction: TransferChecked",
      `Program ${token} success`,
      "Program data: AQID",
      `Program ${spoke} success`,
      "Program log: written after every program returned",
    ];
    expect(solanaLogEvents(chain, lines)).toStrictEqual([
      { emitter: program(memo), topics: ["log"], data: 'Memo (len 66): "0xe74b"' },
      { emitter: program(token), topics: ["log"], data: "Instruction: TransferChecked" },
      { emitter: program(spoke), topics: ["data"], data: "AQID" },
    ]);
  });

  it("reads no event from a transaction whose node kept no log lines", () => {
    expect(solanaLogEvents(chain, [])).toStrictEqual([]);
  });
});
