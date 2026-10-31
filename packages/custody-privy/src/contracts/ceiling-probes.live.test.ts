// oxlint-disable-next-line eslint/no-restricted-imports -- the probes reach Privy's API themselves, past the unit tests' offline dispatcher
import { request as httpsRequest } from "node:https";
import { PrivyClient } from "@privy-io/node";
import { afterAll, describe, expect, it } from "vitest";
import { type AbiFunction, abiFunctionJson } from "../ceiling/policy-rule.js";
import { readPrivyErrorCode, readStatus } from "../privy/privy-wire.schema.js";
import {
  approveTo,
  bridgeAbis,
  type DepositArgs,
  depositData,
  depositV3Data,
  registerData,
} from "../testing/bridge-fixtures.js";

// Probes of what Privy's policy engine can compare on a bridge deposit's arguments, which its docs
// leave unsaid: whether a ceiling can bind a deposit before any rule is written. They run only on
// the Privy test app, with `BINFERENCE_PRIVY_PROBES=1` and the app's id and secret in the
// environment. Each probe makes a policy and a wallet with no owner, so the app secret alone signs,
// asks Privy to sign without broadcasting, and prints what Privy answered. They check nothing of
// binference's own code.
// oxlint-disable-next-line node/no-process-env -- the switch and the test app's credentials, read only here
const environment = process.env;
const {
  BINFERENCE_PRIVY_PROBES: switchOn,
  BINFERENCE_PRIVY_APP_ID: appId = "",
  BINFERENCE_PRIVY_APP_SECRET: appSecret = "",
} = environment;
const probesOn = switchOn === "1" && appId !== "" && appSecret !== "";

const bsc = {
  spokePool: "0x4e8E101924eDE233C13e2D8622DC8aED2872d505",
  usdc: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
  identity: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
} as const;
const baseUsdc = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const saved = "0xeA6F82DbD6C87DE5E542eFbd1f9964879828e4e7";
const unsaved = "0x4C7f6780Ec91C6AC1D99dA89A90db7895a17dAcE";
const other = "0x30435f9D276c6BC54F56161Fb3dFB7bDC2a8DBcB";
// 32 bytes with no zero prefix, as a Solana address has.
const solana = "0x8293b9b2e45c2a36ac6d4ab9da47fd1a77d58c81ebb8a8b1fa64ec6bdd1ba8f6";

interface Condition {
  readonly field_source: "ethereum_transaction" | "ethereum_calldata";
  readonly field: string;
  readonly operator: string;
  readonly value: string | readonly string[];
  readonly abi?: readonly AbiFunction[];
}

interface Rule {
  readonly name: string;
  readonly conditions: readonly Condition[];
}

interface Call {
  readonly to: string;
  readonly data: Hex;
}

type Made = { readonly id: string } | { readonly refused: string };
type Hex = `0x${string}`;

// The unit tests' setup refuses every request through the global fetch; the probes reach Privy
// over node:https, with no retry, so no fake timer ever waits.
async function httpsFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = input instanceof Request ? input.url : String(input);
  const headers = Object.fromEntries(new Headers(init?.headers).entries());
  const body = typeof init?.body === "string" ? init.body : undefined;
  return new Promise((resolve, reject) => {
    const outgoing = httpsRequest(url, { method: init?.method ?? "GET", headers }, (incoming) => {
      const parts: Buffer[] = [];
      incoming.on("data", (part: Buffer) => parts.push(part));
      incoming.on("error", reject);
      incoming.on("end", () => {
        const answer = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) {
          answer.set(name, String(value));
        }
        const status = incoming.statusCode ?? 0;
        resolve(new Response(Buffer.concat(parts), { status, headers: answer }));
      });
    });
    outgoing.on("error", reject);
    outgoing.end(body);
  });
}

const client = new PrivyClient({ appId, appSecret, fetch: httpsFetch, maxRetries: 0 });
const results: Record<string, unknown> = {};

function onTx(field: string, operator: string, value: string | readonly string[]): Condition {
  return { field_source: "ethereum_transaction", field, operator, value };
}

function onData(
  abi: AbiFunction,
  field: string,
  test: { readonly operator: string; readonly value: string | readonly string[] },
): Condition {
  return { field_source: "ethereum_calldata", field, ...test, abi: [abi] };
}

const eq = (value: string) => ({ operator: "eq", value });
const within = (value: readonly string[]) => ({ operator: "in", value });

function wire(rule: Rule) {
  return {
    name: rule.name,
    method: "eth_signTransaction" as const,
    action: "ALLOW" as const,
    conditions: rule.conditions.map((condition) => {
      const { abi, ...rest } = condition;
      const value = typeof rest.value === "string" ? rest.value : [...rest.value];
      return abi === undefined
        ? { ...rest, value }
        : { ...rest, value, abi: abi.map(abiFunctionJson) };
    }),
  };
}

// Privy's answer to a failed call. A policy the probe wrote holds nothing secret, so Privy's reason
// for refusing one may show; every other answer shows its status and code alone.
function failureOf(error: unknown): string {
  if (!(error instanceof Error)) {
    return "unknown";
  }
  const status = readStatus(error);
  const code = "error" in error ? readPrivyErrorCode(error.error) : undefined;
  const reason =
    status?.status === 400 && code === undefined ? ` ${error.message.slice(0, 300)}` : "";
  return `${String(status?.status ?? "no answer")} ${code ?? ""}${reason}`.trim();
}

async function policyOf(name: string, rules: readonly Rule[]): Promise<Made> {
  try {
    const policy = await client.policies().create({
      version: "1.0",
      name: `binference probe ${name}`,
      chain_type: "ethereum",
      rules: rules.map(wire) as never,
    });
    return { id: policy.id };
  } catch (error) {
    return { refused: failureOf(error) };
  }
}

async function walletUnder(
  policy: string,
): Promise<{ readonly id: string; readonly address: Hex }> {
  const wallet = await client.wallets().create({ chain_type: "ethereum", policy_ids: [policy] });
  return { id: wallet.id, address: wallet.address as Hex };
}

async function signs(wallet: string, call: Call): Promise<string> {
  try {
    await client
      .wallets()
      .ethereum()
      .signTransaction(wallet, {
        params: {
          transaction: {
            type: 2,
            chain_id: 56,
            nonce: 0,
            to: call.to,
            value: "0x0",
            data: call.data,
            gas_limit: "0x30d40",
            max_fee_per_gas: "0x3b9aca00",
            max_priority_fee_per_gas: "0x3b9aca00",
          },
        },
      });
    return "signed";
  } catch (error) {
    return failureOf(error);
  }
}

// One probe: the probed policy, a wallet under it, and each call signed or refused.
async function probe(
  name: string,
  rules: readonly Rule[],
  calls: (wallet: Hex) => Readonly<Record<string, Call>>,
): Promise<void> {
  const policy = await policyOf(name, rules);
  if ("refused" in policy) {
    results[name] = { policy: policy.refused };
    return;
  }
  const wallet = await walletUnder(policy.id);
  const answers: Record<string, string> = {};
  for (const [label, call] of Object.entries(calls(wallet.address))) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one request at a time on the test app
    answers[label] = await signs(wallet.id, call);
  }
  results[name] = answers;
}

function spokeCall(abi: AbiFunction): readonly Condition[] {
  return [
    onTx("chain_id", "eq", "56"),
    onTx("to", "eq", bsc.spokePool),
    onData(abi, "function_name", eq(abi.name)),
  ];
}

function deposit(args: Partial<DepositArgs> & { readonly depositor: Hex }): DepositArgs {
  return {
    recipient: saved,
    inputToken: bsc.usdc,
    outputToken: baseUsdc,
    destinationChainId: 8453n,
    ...args,
  };
}

const v3 = bridgeAbis.depositV3;
const b32 = bridgeAbis.deposit;
const lower32 = (address: string): string =>
  `0x${address.slice(2).toLowerCase().padStart(64, "0")}`;
const asIs32 = (address: string): string => `0x${address.slice(2).padStart(64, "0")}`;
const toSpoke = (data: Hex): Call => ({ to: bsc.spokePool, data });

async function probeChainIds(): Promise<void> {
  for (const [form, value] of [
    ["decimal", "8453"],
    ["hex", "0x2105"],
  ] as const) {
    const bound = onData(v3, "depositV3.destinationChainId", eq(value));
    // oxlint-disable-next-line eslint/no-await-in-loop -- one probe at a time
    await probe(
      `P2 ${form}`,
      [{ name: "chain", conditions: [...spokeCall(v3), bound] }],
      (wallet) => ({
        base: toSpoke(depositV3Data(deposit({ depositor: wallet }))),
        optimism: toSpoke(depositV3Data(deposit({ depositor: wallet, destinationChainId: 10n }))),
      }),
    );
  }
}

async function probeEmptyBytes(): Promise<void> {
  for (const [form, value] of [
    ["0x", "0x"],
    ["empty", ""],
  ] as const) {
    const bound = onData(v3, "depositV3.message", eq(value));
    // oxlint-disable-next-line eslint/no-await-in-loop -- one probe at a time
    await probe(
      `P3 ${form}`,
      [{ name: "message", conditions: [...spokeCall(v3), bound] }],
      (wallet) => ({
        empty: toSpoke(depositV3Data(deposit({ depositor: wallet }))),
        oneByte: toSpoke(depositV3Data(deposit({ depositor: wallet, message: "0x01" }))),
      }),
    );
  }
}

async function probeBytes32(): Promise<void> {
  for (const [form, test] of [
    ["lowercase", eq(lower32(saved))],
    ["checksum case", eq(asIs32(saved))],
    ["list", within([lower32(unsaved), lower32(saved), solana])],
  ] as const) {
    const bound = onData(b32, "deposit.recipient", test);
    // oxlint-disable-next-line eslint/no-await-in-loop -- one probe at a time
    await probe(
      `P4 ${form}`,
      [{ name: "recipient", conditions: [...spokeCall(b32), bound] }],
      (wallet) => ({
        saved: toSpoke(depositData(deposit({ depositor: wallet }))),
        solana: toSpoke(depositData(deposit({ depositor: wallet, recipient: solana }))),
        other: toSpoke(depositData(deposit({ depositor: wallet, recipient: other }))),
      }),
    );
  }
}

async function probeDepositors(): Promise<void> {
  const pinned = eq("{{wallet.address}}");
  const as32 = onData(b32, "deposit.depositor", pinned);
  await probe(
    "P5 bytes32 template",
    [{ name: "depositor", conditions: [...spokeCall(b32), as32] }],
    (wallet) => ({
      wallet: toSpoke(depositData(deposit({ depositor: wallet }))),
      other: toSpoke(depositData(deposit({ depositor: unsaved }))),
    }),
  );
  const asAddress = onData(v3, "depositV3.depositor", pinned);
  await probe(
    "P5b address template",
    [{ name: "depositor", conditions: [...spokeCall(v3), asAddress] }],
    (wallet) => ({
      wallet: toSpoke(depositV3Data(deposit({ depositor: wallet }))),
      other: toSpoke(depositV3Data(deposit({ depositor: unsaved }))),
    }),
  );
}

const approve: AbiFunction = {
  type: "function",
  name: "approve",
  inputs: [
    { name: "spender", type: "address" },
    { name: "amount", type: "uint256" },
  ],
  outputs: [{ name: "", type: "bool" }],
  stateMutability: "nonpayable",
};

async function probeNotEqual(): Promise<void> {
  const conditions = [
    onTx("chain_id", "eq", "56"),
    onTx("to", "neq", bsc.identity),
    onData(approve, "approve.spender", within([bsc.spokePool])),
  ];
  await probe("P6 neq", [{ name: "approvals", conditions }], () => ({
    usdc: { to: bsc.usdc, data: approveTo(bsc.spokePool, 1n) },
    identity: { to: bsc.identity, data: approveTo(bsc.spokePool, 1n) },
  }));
}

async function probeOverload(): Promise<void> {
  const { register } = bridgeAbis;
  const conditions = [
    onTx("chain_id", "eq", "56"),
    onTx("to", "eq", bsc.identity),
    onData(register, "function_name", eq("register")),
  ];
  await probe("P8 overload", [{ name: "register", conditions }], () => ({
    uri: { to: bsc.identity, data: registerData.uri },
    none: { to: bsc.identity, data: registerData.none },
    withMetadata: { to: bsc.identity, data: registerData.withMetadata },
  }));
}

// A rule the size of a bridge rule with two recipients, for a destination of its own.
function bridgeSized(index: number): Rule {
  const chain = String(100_000 + index);
  return {
    name: `Bridge depositV3, chain 56 to ${chain}`,
    conditions: [
      ...spokeCall(v3),
      onData(v3, "depositV3.depositor", eq("{{wallet.address}}")),
      onData(v3, "depositV3.recipient", within([saved, unsaved])),
      onData(v3, "depositV3.destinationChainId", eq(chain)),
      onData(v3, "depositV3.inputToken", within([bsc.usdc])),
      onData(v3, "depositV3.outputToken", within([baseUsdc])),
    ],
  };
}

function smallRule(index: number): Rule {
  return {
    name: `Small ${String(index)}`,
    conditions: [onTx("chain_id", "eq", String(index + 1))],
  };
}

const rulesOf = (count: number, make: (index: number) => Rule): readonly Rule[] =>
  Array.from({ length: count }, (_, index) => make(index));

const limitSizes: Record<string, string> = {};

async function acceptsBridgeSized(count: number): Promise<boolean> {
  const policy = await policyOf(`P1 ${String(count)}`, rulesOf(count, bridgeSized));
  limitSizes[String(count)] = "id" in policy ? "accepted" : policy.refused;
  return "id" in policy;
}

// The largest count of bridge-sized rules one policy takes: doubling, then a bisection.
async function probeRuleLimit(): Promise<void> {
  let low = 0;
  let high = 0;
  for (const count of [50, 100, 200, 400, 800]) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one create at a time on the test app
    if (!(await acceptsBridgeSized(count))) {
      high = count;
      break;
    }
    low = count;
  }
  while (high - low > 3) {
    const middle = Math.floor((low + high) / 2);
    // oxlint-disable-next-line eslint/no-await-in-loop -- a bisection, one create at a time
    [low, high] = (await acceptsBridgeSized(middle)) ? [middle, high] : [low, middle];
  }
  results["P1"] = { sizes: limitSizes, largestAccepted: low, smallestRefused: high };
}

async function probeSmallRules(): Promise<void> {
  const answers: Record<string, string> = {};
  for (const count of [100, 200, 400]) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one create at a time on the test app
    const policy = await policyOf(`P1b ${String(count)}`, rulesOf(count, smallRule));
    answers[`small ${String(count)}`] = "id" in policy ? "accepted" : policy.refused;
  }
  results["P1b"] = answers;
}

describe.runIf(probesOn)("privy's policy engine on bridge arguments", () => {
  afterAll(() => {
    // oxlint-disable-next-line no-console -- the probes' answers are their output
    console.log(JSON.stringify(results, undefined, 2));
  });

  it.each([
    ["probe 2: a uint256 argument as decimal text and as hex", probeChainIds],
    ["probe 3: a bytes argument against the empty value", probeEmptyBytes],
    ["probe 4: a bytes32 argument, by case and in a list", probeBytes32],
    ["probe 5: a depositor pinned to the wallet, as bytes32 and as an address", probeDepositors],
    ["probe 6: an approval kept from one contract with neq", probeNotEqual],
    ["probe 8: one overload of a name matched by its ABI", probeOverload],
    ["probe 1: the bridge-sized rules one policy holds", probeRuleLimit],
    ["probe 1b: the small rules one policy holds", probeSmallRules],
  ])(
    "asks %s",
    async (_name, run) => {
      await expect(run()).resolves.toBeUndefined();
    },
    600_000,
  );
});
