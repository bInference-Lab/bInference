import { declaredContracts, venueDeclarationSchema } from "@binference/chain";
import { describe, expect, it } from "vitest";
import { bsc, bscCeilingCaps } from "../bsc.js";
import { bscBridgeRoutes } from "../routes/bsc-bridge-routes.js";
import { bscVenueCalls } from "./bsc-venue-calls.js";

interface AbiInput {
  readonly type: string;
  readonly name: string;
}

function inputsOf(abi: unknown): readonly AbiInput[] {
  const { inputs } = abi as { readonly inputs: readonly AbiInput[] };
  return inputs;
}

function nameOf(abi: unknown): string {
  return (abi as { readonly name: string }).name;
}

// The inputs that name an account but credit it nothing, each with what it is. Every other address
// or bytes32 input of a declared call must be pinned to the wallet or bound by its bridge rule.
const creditsNothing: Readonly<Record<string, string>> = {
  "delegate.operatorAddress": "the validator, which holds the stake for the delegator",
  "undelegate.operatorAddress": "the validator the stake leaves",
  "claim.operatorAddress": "the validator whose unbonded BNB pays the caller",
  "depositV3.exclusiveRelayer": "the relayer that may fill first; any fill pays the recipient",
};

// The inputs of a call only a bridge wallet makes that no rule can bind, each with why the bridge
// wallet alone holds it (decision 0303).
const bridgeWalletOnly: Readonly<Record<string, string>> = {
  "depositErc20.token": "the token that leaves the bridge wallet",
  "depositErc20.id": "Relay's order id; the recipient lives in the order, off chain",
};

function boundInputs(
  calls: NonNullable<(typeof bscVenueCalls)[string]["calls"]>,
): readonly string[] {
  return calls.flatMap((item) => {
    const { bridge } = item;
    const bridged = bridge === undefined ? [] : [bridge.recipient, bridge.tokenIn, bridge.tokenOut];
    return [...item.walletInputs, ...bridged].map((input) => `${nameOf(item.abi)}.${input}`);
  });
}

type Calls = (typeof bscVenueCalls)[string];

// Every address or bytes32 input of a venue's calls left unbound, and every struct input.
function auditOf(contracts: Calls) {
  const calls = contracts.calls ?? [];
  const bound = new Set(boundInputs(calls));
  const loose = calls.flatMap((call) =>
    inputsOf(call.abi)
      .filter((input) => input.type === "address" || input.type === "bytes32")
      .map((input) => `${nameOf(call.abi)}.${input.name}`)
      .filter((input) => !bound.has(input) && creditsNothing[input] === undefined)
      .filter((input) => call.onlyWallet !== "bridge" || bridgeWalletOnly[input] === undefined),
  );
  const structs = calls.flatMap((call) =>
    inputsOf(call.abi).filter((input) => input.type.startsWith("tuple")),
  );
  return { loose, structs };
}

function signaturesOf(contracts: Calls): readonly string[] {
  return (contracts.calls ?? []).map((call) => {
    const types = inputsOf(call.abi).map((input) => input.type);
    return `${nameOf(call.abi)}(${types.join(",")})`;
  });
}

function everyCall() {
  return Object.values(bscVenueCalls).flatMap((contracts) => contracts.calls ?? []);
}

describe("the staking, bridge and identity calls on bsc", () => {
  it.each(Object.entries(bscVenueCalls))(
    "declares %s's calls on contracts the registry lists for it",
    (venue, contracts) => {
      const declaration = venueDeclarationSchema.parse({ id: venue, contracts: [contracts] });
      expect(declaredContracts(declaration, { ref: contracts.chain, definition: bsc }).ok).toBe(
        true,
      );
    },
  );

  it.each(Object.entries(bscVenueCalls))(
    "leaves no input of %s's calls that names an account unbound, and no struct Privy cannot read",
    (_venue, contracts) => {
      expect(auditOf(contracts)).toStrictEqual({ loose: [], structs: [] });
    },
  );

  it("names the signatures read from each project's source, so a typo fails here", () => {
    const signatures = Object.values(bscVenueCalls).flatMap(signaturesOf);
    expect(signatures).toStrictEqual([
      "delegate(address,bool)",
      "undelegate(address,uint256)",
      "claim(address,uint256)",
      "deposit()",
      "requestWithdraw(uint256)",
      "claimWithdrawByUUID(uint256)",
      "depositV3(address,address,address,address,uint256,uint256,uint256,address,uint32,uint32,uint32,bytes)",
      "depositErc20(address,address,uint256,bytes32)",
      "register(string)",
    ]);
  });

  it("lets only a bridge wallet deposit into Relay or approve its depository", () => {
    const relay = bscVenueCalls["relay"];
    expect(relay?.calls?.map((call) => call.onlyWallet)).toStrictEqual(["bridge"]);
    expect([relay?.spenders, relay?.onlyWalletSpenders]).toStrictEqual([
      undefined,
      { bridge: ["depository"] },
    ]);
  });

  it("caps every token a bridge route takes from bsc, so no deposit passes the 24-hour caps", () => {
    const capped = new Set(bscCeilingCaps.tokens.map((item) => item.symbol));
    const uncapped = bscBridgeRoutes.filter((route) => !capped.has(route.leaves));
    expect(uncapped).toStrictEqual([]);
  });

  it("lets only StakeHub's delegate and Lista's deposit carry more than the cap per call, up to 100 BNB", () => {
    const raised = everyCall().filter((call) => call.maxValueBase !== undefined);
    expect(raised.map((call) => [nameOf(call.abi), call.maxValueBase])).toStrictEqual([
      ["delegate", 100n * 10n ** 18n],
      ["deposit", 100n * 10n ** 18n],
    ]);
  });

  it("keeps every approval away from the identity registry", () => {
    expect(bscVenueCalls["erc8004"]?.unapproved).toStrictEqual(["identity-registry"]);
  });
});
