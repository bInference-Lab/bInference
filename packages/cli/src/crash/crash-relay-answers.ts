import { readChainReply, readChainRequest } from "./crash-chain.schema.js";

/**
 * A relay's answer to a send as BSC's nodes give it: they answer bytes their pool holds already
 * with geth's "already known", which the relay sender reads as taken, where anvil words it
 * "transaction already imported".
 */
export function asBscAnswer(request: string, answer: string): string {
  const reply = readChainReply(answer);
  if (!("error" in reply) || !/already imported/iu.test(reply.error.message)) {
    return answer;
  }
  const id = readChainRequest(request)?.id ?? null;
  return JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32_000, message: "already known" } });
}

/** What BSC's nodes answer a send from a wallet they read as unable to pay. */
export function refusalOf(request: string): string {
  const id = readChainRequest(request)?.id ?? null;
  const message = "insufficient funds for gas * price + value";
  return JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32_000, message } });
}
