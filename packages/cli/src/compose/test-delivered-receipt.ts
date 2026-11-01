import {
  accountRefSchema,
  assetRefSchema,
  type ChainDefinition,
  chainRefSchema,
  isTxHash,
  type TxHash,
} from "@binference/chain";
import { createFakeDeliveryReader } from "@binference/chain/testing";
import { baseMainnet, solana } from "@binference/chains";
import { BinferenceError } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import { type CardClosing, receiptLine } from "@binference/engine";
import { startBridgeFollowBench } from "@binference/engine/testing";
import { cardLineText, createFormatter, type MessageLocale } from "@binference/i18n";
import { selfHostedDestinationChains } from "./destination-chains.js";

/** A delivery the test lands on a chain a bridge delivers to. */
export interface LandedDelivery {
  readonly chain: ChainDefinition;
  /** The recipient's address there. */
  readonly recipient: string;
  /** The fill's transaction hash there. */
  readonly fill: string;
}

/** A delivery to a Base address, in a transaction there. */
export const baseDelivery: LandedDelivery = {
  chain: baseMainnet,
  recipient: "0x168E0c5AE6B259883D878C89C042ad6347F8ba85",
  fill: `0x${"f8".repeat(32)}`,
};

/** A delivery to a Solana wallet, in a transaction there. */
export const solanaDelivery: LandedDelivery = {
  chain: solana,
  recipient: "A9YsiCuAtY5RT3nfLKZTz2EuxxXf3FZogPqHkSH89SXT",
  fill: "4QN4bPaaZguhX2hxpkabijEJcKZ4WpFn4TxTsGCVyuJd5ccSTGn6BN7aaowMjRjyzvy3gGWag75ouQPC6p7zDbu4",
};

const refusing = {
  request: async () => Promise.reject(new Error("No network in a unit test.")),
};
const deposit = `0x${"d1".repeat(32)}`;

function hashOf(text: string): TxHash {
  if (!isTxHash(text)) {
    throw new BinferenceError({ code: "test.bad_hash", message: `${text} is no hash.` });
  }
  return text;
}

// The destination as the self-hosted engine takes it, and its USDC as the registry lists it.
function destinationOf(chain: ChainDefinition) {
  const destinations = selfHostedDestinationChains({ http: refusing, clock: createManualClock() });
  const ref = chainRefSchema.parse(chain.id);
  const destination = destinations.find((item) => item.ref === ref);
  const usdc = Object.entries(destination?.assets ?? {}).find(([, info]) => info.symbol === "USDC");
  if (destination === undefined || usdc === undefined) {
    throw new BinferenceError({ code: "test.no_usdc", message: `${chain.name} lists no USDC.` });
  }
  return { destinations, destination, usdc: assetRefSchema.parse(usdc[0]) };
}

/**
 * The receipt line of a bridge that delivered 12.5 USDC on `landed.chain`, as the owner's surfaces
 * show it in `locale`: the follower reads the fill, then the receipt reads the chains the
 * self-hosted engine bridges to.
 */
export async function deliveredReceiptText(
  landed: LandedDelivery,
  locale: MessageLocale,
): Promise<string> {
  const { destinations, destination, usdc } = destinationOf(landed.chain);
  const recipient = accountRefSchema.parse(`${destination.ref}:${landed.recipient}`);
  const received = { asset: usdc, base: 12_500_000n };
  const fill = { chain: destination.ref, hash: hashOf(landed.fill) };
  const reader = createFakeDeliveryReader(destination.ref);
  const events = [{ emitter: recipient, topics: [], data: `filled ${deposit}` }];
  reader.land(fill.hash, { recipient, received: [received], events });
  const bench = await startBridgeFollowBench({
    readers: [reader],
    recipient,
    minOut: received,
    fill,
    chainName: destination.name,
  });
  await bench.follow();
  const receipt = await bench.receipt(destinations);
  if (receipt === undefined) {
    throw new BinferenceError({ code: "test.no_receipt", message: "The bridge did not settle." });
  }
  const closing: CardClosing = {
    outcome: "confirmed",
    answeredBy: { surface: "telegram", by: "owner" },
    atMs: 0,
  };
  const line = receiptLine(closing, receipt.outcome);
  const formatter = createFormatter({ locale, timeZone: "UTC" });
  return cardLineText(line, { formatter, assets: { ...destination.assets, ...receipt.assets } });
}
