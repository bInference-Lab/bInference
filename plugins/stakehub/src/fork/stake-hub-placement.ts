import { bscContract, type Fork } from "@binference/chain-evm/fork";
import {
  type AccountRef,
  type Amount,
  accountRefParts,
  accountRefSchema,
  isTxHash,
  type StakingVenue,
  type TxDraft,
  type TxHash,
} from "@binference/plugin-sdk";
import { decodeEvmDraft, parseEvmAddress } from "@binference/plugin-sdk/evm";
import {
  type Address,
  encodeFunctionData,
  getAddress,
  keccak256,
  parseAbi,
  stringToHex,
  toHex,
  type TransactionReceipt,
} from "viem";
import { createStakeHubVenue } from "../stakehub-venue.js";
import { type ForkValidators, warmValidators, warmWallet } from "./warm-stake-hub.js";

/** StakeHub and Multicall3 on BSC, as the chain registry lists them. */
export const stakeHub: Address = bscContract("stakehub", "stake-hub");
const multicall = bscContract("multicall3", "multicall3");
// BNB Smart Chain's slash indicator, the one caller StakeHub takes a downtime slash from
// (`SystemV2.sol`'s `SLASH_CONTRACT_ADDR`).
const slashIndicator: Address = "0x0000000000000000000000000000000000001001";
const slashAbi = parseAbi([
  "function getValidatorConsensusAddress(address operatorAddress) view returns (address)",
  "function downtimeSlash(address consensusAddress)",
]);
const walletBalance = 10n * 10n ** 18n;

/** The venue on the fork, a validator that takes stakes, and one a downtime slash jailed. */
export interface Placed {
  readonly fork: Fork;
  readonly venue: StakingVenue;
  readonly validators: ForkValidators;
  readonly active: AccountRef;
  readonly jailed: AccountRef;
  /** StakeHub's least stake, in BNB. */
  readonly minStake: Amount;
}

/** The account on the fork's chain at the address. */
export function accountOn(fork: Fork, address: Address): AccountRef {
  return accountRefSchema.parse(`${fork.chain.ref}:${address}`);
}

/** The EVM address of an account. */
export function addressOf(account: AccountRef): Address {
  const parsed = parseEvmAddress(accountRefParts(account).address);
  if (!parsed.ok) {
    throw new Error(`${account} names no EVM address.`);
  }
  return parsed.value;
}

/** The hashes of the transactions of the receipts. */
export function hashesOf(receipts: readonly TransactionReceipt[]): readonly TxHash[] {
  return receipts.map(({ transactionHash }) => {
    if (!isTxHash(transactionHash)) {
      throw new Error("anvil answered a receipt with no transaction hash.");
    }
    return transactionHash;
  });
}

/** Sends each draft in turn from its sender, which anvil impersonates, and answers the receipts. */
export async function runDrafts(
  fork: Fork,
  drafts: readonly TxDraft[],
): Promise<readonly TransactionReceipt[]> {
  const receipts: TransactionReceipt[] = [];
  for (const draft of drafts) {
    const call = decodeEvmDraft(draft);
    if (!call.ok) {
      throw new Error("The venue built a draft that is no EVM call.");
    }
    // oxlint-disable-next-line eslint/no-await-in-loop -- each call needs the one before it
    receipts.push(await fork.send(call.value));
  }
  return receipts;
}

// Jails the validator as StakeHub's slash indicator does for downtime.
async function jail(fork: Fork, operator: Address): Promise<void> {
  const consensus = await fork.client.readContract({
    address: stakeHub,
    abi: slashAbi,
    functionName: "getValidatorConsensusAddress",
    args: [operator],
  });
  await fork.call("anvil_impersonateAccount", [slashIndicator]);
  await fork.call("anvil_setBalance", [slashIndicator, toHex(10n ** 18n)]);
  const data = encodeFunctionData({
    abi: slashAbi,
    functionName: "downtimeSlash",
    args: [consensus],
  });
  const receipt = await fork.send({ from: slashIndicator, to: stakeHub, data });
  if (receipt.status !== "success") {
    throw new Error("The slash indicator could not jail the validator on the fork.");
  }
}

/**
 * Places the venue on the fork: loads StakeHub's state, makes the venue over the fork's RPC, takes
 * the first validator that takes stakes, and jails the next one through the slash indicator.
 */
export async function placeStakeHub(fork: Fork, signal: AbortSignal): Promise<Placed> {
  const validators = await warmValidators(fork, stakeHub);
  const venue = createStakeHubVenue({
    chain: fork.chain.ref,
    coin: fork.chain.nativeAsset,
    rpc: fork.rpc,
    contracts: { "stake-hub": accountOn(fork, stakeHub) },
    multicall: accountOn(fork, multicall),
  });
  const options = await venue.options({ signal });
  const free = options.validators.filter((item) => !item.jailed);
  const [active, toJail] = free;
  if (active === undefined || toJail === undefined) {
    throw new Error("The fork lists fewer than two validators that take stakes.");
  }
  await jail(fork, addressOf(toJail.validator));
  const { minStake } = options;
  return { fork, venue, validators, active: active.validator, jailed: toJail.validator, minStake };
}

/**
 * A wallet no one used, holding 10 BNB and no code, that anvil signs for, with its state at every
 * credit contract loaded.
 */
export async function freshWallet(placed: Placed, label: string): Promise<AccountRef> {
  const { fork } = placed;
  const address = getAddress(keccak256(stringToHex(`binference stakehub ${label}`)).slice(0, 42));
  await fork.call("anvil_impersonateAccount", [address]);
  await fork.call("anvil_setBalance", [address, toHex(walletBalance)]);
  await warmWallet(fork, placed.validators, address);
  return accountOn(fork, address);
}
