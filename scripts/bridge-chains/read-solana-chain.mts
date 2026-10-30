import {
  type ChainDefinition,
  type DeliveryReader,
  isTxHash,
  parseAccountRef,
  parseAssetRef,
} from "@binference/chain";
import {
  createSolanaDeliveryReader,
  createSolanaRpcClient,
  parseSolanaAddress,
  readSolanaMint,
  type SolanaChain,
  solanaChainOf,
} from "@binference/chain-solana";
import type { LiveParts } from "./live-parts.mjs";
import { oneByOne } from "./one-by-one.mjs";
import type { ReportedFill } from "./read-evm-chain.mjs";
import { unwrapped } from "./unwrapped.mjs";

type Rpc = ReturnType<typeof createSolanaRpcClient>;
type Endpoint = ChainDefinition["rpcs"][number];
type Token = ChainDefinition["tokens"][number];

async function readEndpoint(
  definition: ChainDefinition,
  endpoint: Endpoint,
  parts: LiveParts,
): Promise<string> {
  const { name, url } = endpoint;
  const one = createSolanaRpcClient({ endpoints: [{ name, url }], ...parts, timeoutMs: 20_000 });
  const genesis = await one.getGenesisHash().send({ abortSignal: parts.signal });
  const reference = definition.id.split(":")[1] ?? "";
  return `- RPC ${name} (${url}): genesis ${genesis} ${genesis.startsWith(reference) ? "ok" : "WRONG"}`;
}

async function readMint(rpc: Rpc, token: Token, signal: AbortSignal): Promise<string> {
  const read = await readSolanaMint(rpc, unwrapped(parseSolanaAddress(token.address)), signal);
  return (
    `- ${token.symbol} ${token.address}: 32-byte base58 ok, program ${read.owner} (${read.program}), ` +
    `decimals ${String(read.decimals)} ${read.decimals === token.decimals ? "ok" : "WRONG"}, ` +
    `supply ${read.supply.toString()}, mint authority ${read.mintAuthority ?? "-"}, ` +
    `freeze authority ${read.freezeAuthority ?? "-"}`
  );
}

async function readFill(
  reader: DeliveryReader,
  chain: SolanaChain,
  fill: ReportedFill,
): Promise<string> {
  const asset = unwrapped(parseAssetRef(`${chain.ref}/token:${fill.token}`));
  const recipient = unwrapped(parseAccountRef(`${chain.ref}:${fill.recipient}`));
  if (!isTxHash(fill.hash)) {
    throw new Error(`${fill.hash} is no transaction hash.`);
  }
  const signal = AbortSignal.timeout(60_000);
  const delivery = await reader.delivery({ hash: fill.hash, recipient, asset }, { signal });
  const read = delivery?.received.base ?? 0n;
  return (
    `- ${fill.bridge} fill ${fill.hash}: reported ${fill.amount.toString()}, read ${read.toString()} ` +
    `${read === fill.amount ? "ok" : "DIFFERS"}, status ${delivery?.status ?? "none"}, ` +
    `final ${String(delivery?.final)}`
  );
}

/** Reads every mint of a Solana chain file back on the cluster, and the fills a bridge reported. */
export async function readSolanaChain(
  definition: ChainDefinition,
  fills: readonly ReportedFill[],
  parts: LiveParts,
): Promise<string[]> {
  const chain = solanaChainOf(definition);
  const endpoints = definition.rpcs.map(({ name, url }) => ({ name, url }));
  const rpc = createSolanaRpcClient({ endpoints, ...parts, timeoutMs: 20_000 });
  const reader = createSolanaDeliveryReader({ rpc, chain });
  return [
    `### ${definition.name} (${definition.id})`,
    ...(await oneByOne(definition.rpcs, async (endpoint) =>
      readEndpoint(definition, endpoint, parts),
    )),
    ...(await oneByOne(definition.tokens, async (token) => readMint(rpc, token, parts.signal))),
    ...(await oneByOne(fills, async (fill) => readFill(reader, chain, fill))),
  ];
}
