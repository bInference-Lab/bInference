import { getAddressEncoder, isAddress } from "@solana/kit";
import { bytesToHex, type Hex, hashStruct, isHex, size } from "viem";
import { relayChainNamed } from "../relay-chains.js";
import type { OrderRefund, RelayOrder } from "./relay-order.schema.js";

// The EIP-712 types Relay hashes a version 1 order with, as its settlement protocol's order id
// does: a struct hash with no domain, every address as the bytes of its chain's own encoding.
const orderTypes = {
  Order: [
    { name: "version", type: "string" },
    { name: "solverChainId", type: "string" },
    { name: "solver", type: "address" },
    { name: "salt", type: "uint256" },
    { name: "inputs", type: "Input[]" },
    { name: "output", type: "Output" },
    { name: "fees", type: "Fee[]" },
  ],
  Input: [
    { name: "payment", type: "InputPayment" },
    { name: "refunds", type: "InputRefund[]" },
  ],
  InputPayment: [
    { name: "chainId", type: "string" },
    { name: "currency", type: "bytes" },
    { name: "amount", type: "uint256" },
    { name: "weight", type: "uint256" },
  ],
  InputRefund: [
    { name: "chainId", type: "string" },
    { name: "recipient", type: "bytes" },
    { name: "currency", type: "bytes" },
    { name: "minimumAmount", type: "uint256" },
    { name: "deadline", type: "uint32" },
    { name: "extraData", type: "bytes" },
  ],
  Output: [
    { name: "chainId", type: "string" },
    { name: "payments", type: "OutputPayment[]" },
    { name: "deadline", type: "uint32" },
    { name: "calls", type: "bytes[]" },
    { name: "extraData", type: "bytes" },
  ],
  OutputPayment: [
    { name: "recipient", type: "bytes" },
    { name: "currency", type: "bytes" },
    { name: "minimumAmount", type: "uint256" },
    { name: "expectedAmount", type: "uint256" },
  ],
  Fee: [
    { name: "recipientChainId", type: "string" },
    { name: "recipient", type: "bytes" },
    { name: "currencyChainId", type: "string" },
    { name: "currency", type: "bytes" },
    { name: "amount", type: "uint256" },
  ],
} as const;

// An address as the bytes an order hashes: 20 bytes of hex on an EVM chain, the 32 bytes of a
// base58 address on Solana; none on a chain Relay names that no listed route touches, or for an
// address its chain does not read.
function addressBytes(protocol: string, address: string): Hex | undefined {
  const chain = relayChainNamed(protocol);
  if (chain?.vm === "evm" && isHex(address) && size(address) === 20) {
    return `0x${address.slice(2).toLowerCase()}`;
  }
  if (chain?.vm === "svm" && isAddress(address)) {
    return bytesToHex(Uint8Array.from(getAddressEncoder().encode(address)));
  }
  return undefined;
}

// A refund with its addresses as their chain's bytes, or none when one does not read.
function hashedRefund(refund: OrderRefund) {
  const recipient = addressBytes(refund.chainId, refund.recipient);
  const currency = addressBytes(refund.chainId, refund.currency);
  return recipient === undefined || currency === undefined
    ? undefined
    : { ...refund, recipient, currency };
}

// The order as its struct hash takes it, or none when an address does not read on its chain.
function hashedOrder(order: RelayOrder) {
  const { input, output } = order;
  const paid = addressBytes(input.chainId, input.currency);
  const recipient = addressBytes(output.chainId, output.recipient);
  const currency = addressBytes(output.chainId, output.currency);
  const refunds = order.refunds.map(hashedRefund).filter((refund) => refund !== undefined);
  const isRead =
    paid !== undefined &&
    recipient !== undefined &&
    currency !== undefined &&
    refunds.length === order.refunds.length;
  if (!isRead) {
    return undefined;
  }
  const { minimumAmount, expectedAmount, deadline, extraData } = output;
  return {
    version: order.version,
    solverChainId: order.solverChainId,
    solver: order.solver,
    salt: order.salt,
    inputs: [{ payment: { ...input, currency: paid }, refunds }],
    output: {
      chainId: output.chainId,
      payments: [{ recipient, currency, minimumAmount, expectedAmount }],
      deadline,
      calls: [],
      extraData,
    },
    fees: [],
  };
}

/**
 * The id of a Relay order, worked out from its data as Relay's settlement protocol does: the
 * EIP-712 struct hash of the order, each address as its chain's bytes. A deposit that names this
 * id pays this order and no other (Relay's input validation guide). An order naming a chain no
 * listed route touches, or an address its chain does not read, has none: `undefined`.
 */
export function orderIdOf(order: RelayOrder): Hex | undefined {
  const data = hashedOrder(order);
  return data === undefined
    ? undefined
    : hashStruct({ types: orderTypes, primaryType: "Order", data });
}
