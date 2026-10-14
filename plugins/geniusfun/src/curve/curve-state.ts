import type { Address } from "viem";
import {
  type CurveReserves,
  feeCallData,
  numberOf,
  reservesCallData,
  reservesOf,
  sellableCallData,
  snipeTaxCallData,
} from "../contracts/genius-calls.js";
import { type GeniusRead, readCall } from "../contracts/read-genius.js";

/**
 * What a curve reads now for a buy paying one recipient: its reserves, its fee, the tokens it still
 * sells, and the snipe tax that recipient would pay.
 */
export interface BuyState extends CurveReserves {
  /** The curve's own fee on each trade, in basis points, taken from the quote side. */
  readonly feeBps: bigint;
  /** The tokens it still sells before it graduates; none once it is ready to. */
  readonly sellable: bigint;
  /** `currentSnipeTaxBps(recipient)`: the launch-window tax before the curve bounds it. */
  readonly snipeTaxBps: bigint;
}

// A curve's reserves, fee and sellable tokens at the latest block, all at once.
async function readCurveState(
  read: GeniusRead,
  curve: Address,
): Promise<Omit<BuyState, "snipeTaxBps">> {
  const [reserves, feeBps, sellable] = await Promise.all([
    readCall(read, { to: curve, data: reservesCallData, what: "the curve's reserves" }, reservesOf),
    readCall(read, { to: curve, data: feeCallData, what: "the curve's fee" }, numberOf),
    readCall(read, { to: curve, data: sellableCallData, what: "the curve's supply" }, numberOf),
  ]);
  return { ...reserves, feeBps, sellable };
}

/**
 * Reads a curve's state and the snipe tax a buy paying `recipient` would pay now, at the latest
 * block, all at once. A read that reverts, or answers outside its shape, is a fault
 * (`geniusfun.read_failed`). Rejects when no node answers, and with the signal's reason once it
 * aborts.
 */
export async function readBuyState(
  read: GeniusRead,
  curve: Address,
  recipient: Address,
): Promise<BuyState> {
  const asked = { to: curve, data: snipeTaxCallData(recipient), what: "the curve's snipe tax" };
  const [state, snipeTaxBps] = await Promise.all([
    readCurveState(read, curve),
    readCall(read, asked, numberOf),
  ]);
  return { ...state, snipeTaxBps };
}
