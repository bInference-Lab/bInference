import {
  type AccountRef,
  accountRefParts,
  accountRefSchema,
  type TxDraft,
} from "@binference/plugin-sdk";
import { encodeEvmDraft } from "@binference/plugin-sdk/evm";
import { type Address, encodeFunctionData, type Hex, parseAbi } from "viem";

// StakeHub's siblings and look-alikes of the calls the venue builds, written apart from its
// encoders.
const othersAbi = parseAbi([
  "function redelegate(address srcValidator, address dstValidator, uint256 shares, bool delegateVotePower)",
  "function claimBatch(address[] operatorAddresses, uint256[] requestNumbers)",
  "function syncGovToken(address[] operatorAddresses, address account)",
  "function delegate(address operatorAddress, bool delegateVotePower) payable",
  "function undelegate(address operatorAddress, uint256 shares)",
  "function claim(address operatorAddress, uint256 requestNumber)",
]);

/** Who the foreign drafts are from, which validators they name, and another account. */
export interface ForeignParts {
  readonly wallet: AccountRef;
  readonly hub: Address;
  readonly validator: Address;
  readonly otherValidator: Address;
  /** An account that is not StakeHub, such as another wallet or a token. */
  readonly other: Address;
}

/**
 * Drafts from the wallet that the StakeHub venue must never decode, since each could credit
 * another account, pays StakeHub in a way it never builds, or calls another contract:
 * `redelegate`, `claimBatch`, `syncGovToken` naming another account, a `delegate` handing over
 * votes, a `claim` of every part, a `delegate` to another contract, bytes past a call's
 * arguments, and coin sent with an `undelegate` or a `claim`.
 */
export function foreignDrafts(parts: ForeignParts): readonly TxDraft[] {
  const { wallet, hub, validator, otherValidator, other } = parts;
  const chain = accountRefParts(wallet).chain;
  const draft = (to: Address, data: Hex, value = 0n): TxDraft =>
    encodeEvmDraft({ from: wallet, to: accountRefSchema.parse(`${chain}:${to}`), value, data });
  const call = (data: Parameters<typeof encodeFunctionData<typeof othersAbi>>[0]) =>
    encodeFunctionData(data);
  const abi = othersAbi;
  const claimOne = call({ abi, functionName: "claim", args: [validator, 1n] });
  const delegateWithVotes = call({ abi, functionName: "delegate", args: [validator, true] });
  const delegate = call({ abi, functionName: "delegate", args: [validator, false] });
  return [
    draft(
      hub,
      call({ abi, functionName: "redelegate", args: [validator, otherValidator, 1n, false] }),
    ),
    draft(hub, call({ abi, functionName: "claimBatch", args: [[validator], [1n]] })),
    draft(hub, call({ abi, functionName: "syncGovToken", args: [[validator], other] })),
    draft(hub, delegateWithVotes, 10n ** 18n),
    draft(hub, call({ abi, functionName: "claim", args: [validator, 0n] })),
    draft(other, delegate, 10n ** 18n),
    draft(hub, `${claimOne}00`),
    draft(hub, claimOne, 1n),
    draft(hub, call({ abi, functionName: "undelegate", args: [validator, 1n] }), 1n),
    draft(hub, delegate),
  ];
}
