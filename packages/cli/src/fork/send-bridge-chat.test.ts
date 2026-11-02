import { type AccountRef, accountRefSchema, chainRefSchema } from "@binference/chain";
import { erc20AssetRef, evmAccountRef } from "@binference/chain-evm";
import { bscContract, bscToken, type Fork, withFork } from "@binference/chain-evm/fork";
import { createSolanaAddressCodec } from "@binference/chain-solana";
import { baseMainnet, solana } from "@binference/chains";
import { type Id, idSchema } from "@binference/core";
import { callsReply, textReply } from "@binference/runtime/testing";
import {
  type Address,
  getAddress,
  type Hex,
  keccak256,
  pad,
  parseAbi,
  parseEventLogs,
  stringToHex,
  toHex,
} from "viem";
import { describe, expect, it } from "vitest";
import { ownerText, superviseRuntime, watchChat } from "../e2e/runtime-machine.js";
import { solanaPerson } from "./bridge-arrivals.js";
import { forkLimits, startMining } from "./executor-rig.js";
import { buyFor, heldOn } from "./fork-holdings.js";
import { type OwnerChatMachine, startOwnerChatMachine } from "./owner-chat-machine.js";
import {
  ask,
  type Chat,
  confirm,
  live,
  liveAgent as agent,
  messageText,
  never,
  type Step,
  until,
} from "./owner-chat-steps.js";
import { expectValue } from "./rig-calls.js";
import { placeName } from "./space-id-names.js";

// The send and bridge skeleton: the owner asks in Telegram (the synthetic Bot API), the scripted
// model proposes with the agent's own tools, each card reaches the owner's chat, and the owner's
// Confirm sends on a BSC fork. A send pays a `.bnb` name placed on SPACE ID's registry on the fork;
// a bridge to an address saved for Base deposits through Across, and one to an address saved for
// Solana through Relay from the bridge wallet, each quoted and built over the bridge's live API.
// Each delivery is then read from a recorded destination answer, restamped for the fork's deposit,
// and the card's message ends as the delivered receipt.

const label = "binference-skeleton-alice";
const name = `${label}.bnb`;
const alice = accountOf("binference skeleton alice");
const baseHolder = accountOf("binference skeleton base holder");
const usdt = bscToken("USDT");
const usdc = bscToken("USDC");
const baseRef = chainRefSchema.parse(baseMainnet.id);
const solanaRef = chainRefSchema.parse(solana.id);
const done = String.fromCodePoint(0x2705);
const entries = {
  alice: idSchema("adr").parse("adr_0190f1c2-3a4b-7c5d-8e6f-000000000341"),
  base: idSchema("adr").parse("adr_0190f1c2-3a4b-7c5d-8e6f-000000000342"),
  solana: idSchema("adr").parse("adr_0190f1c2-3a4b-7c5d-8e6f-000000000343"),
};
const deposits = parseAbi([
  "event FundsDeposited(bytes32 inputToken, bytes32 outputToken, uint256 inputAmount, uint256 outputAmount, uint256 indexed destinationChainId, uint256 indexed depositId, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityDeadline, bytes32 indexed depositor, bytes32 recipient, bytes32 exclusiveRelayer, bytes message)",
  "event RelayErc20Deposit(address from, address token, uint256 amount, bytes32 id)",
]);

function accountOf(phrase: string): Address {
  return getAddress(keccak256(stringToHex(phrase)).slice(0, 42));
}

// The rig's main wallet and its bridge wallet.
function walletsOf(machine: OwnerChatMachine) {
  const [main, bridge] = machine.rig.rigWallets;
  return { main: main ?? never(), bridge: bridge ?? never() };
}

// The main wallet holds BNB and what 0.1 BNB buys of USDT, the bridge wallet BNB and what 0.05 BNB
// buys of USDC; neither, nor Alice, holds code.
async function fund(fork: Fork, machine: OwnerChatMachine): Promise<void> {
  const { main, bridge } = walletsOf(machine);
  const plain = [main.address, bridge.address, alice];
  await Promise.all(plain.map(async (address) => fork.call("anvil_setCode", [address, "0x"])));
  await fork.call("anvil_setBalance", [main.address, toHex(3n * 10n ** 17n)]);
  await fork.call("anvil_setBalance", [bridge.address, toHex(10n ** 17n)]);
  await buyFor(fork, { token: usdt, to: main.address, value: 10n ** 17n });
  await buyFor(fork, { token: usdc, to: bridge.address, value: 5n * 10n ** 16n });
}

// An address the owner saved with the owner key three days ago, as `address add` saves one.
async function save(
  machine: OwnerChatMachine,
  entry: { readonly id: Id<"adr">; readonly account: AccountRef; readonly bytes: string },
  entryLabel: string,
): Promise<void> {
  const atMs = Date.now() - 3 * 86_400_000;
  const saved = {
    id: entry.id,
    agentId: agent,
    account: entry.account,
    recipientBytes: entry.bytes,
    label: entryLabel,
    usableAtMs: atMs,
    inCeilingAtMs: atMs,
    createdAtMs: atMs,
  };
  expectValue(await machine.stores.agents.addAddress(saved, live()));
}

/** One wallet's ceiling rules as custody read them back. */
interface CeilingRules {
  readonly wallet: Id<"wal">;
  readonly contract: Address;
  readonly recipients: readonly AccountRef[];
  readonly bridged: readonly AccountRef[];
  readonly capped: Address;
}

// The wallet's ceiling as custody read it back: the contract it calls, whom it pays on BSC and
// through a bridge rule elsewhere, and a 24-hour cap on the token it sends.
async function setCeiling(
  fork: Fork,
  machine: OwnerChatMachine,
  rules: CeilingRules,
): Promise<void> {
  const { wallet } = rules;
  const cap = { asset: erc20AssetRef(fork.chain, rules.capped), limit: String(10n ** 24n) };
  const policy = {
    chains: [fork.chain.ref],
    contracts: [evmAccountRef(fork.chain, rules.contract)],
    perTxNativeBase: String(10n ** 18n),
    recipients: [...rules.recipients],
    bridged: [...rules.bridged],
    dayCaps: [{ ...cap, windowSeconds: 86_400, floorUsdMicros: "0" }],
    launchCalls: [],
    functions: [],
  };
  const policyId = `privy-policy-${wallet.slice(-12)}`;
  const ceiling = { policyId, policy, perTxNativeBase: 10n ** 18n, readAtMs: Date.now() };
  expectValue(await machine.stores.install.updateCeiling({ wallet, ceiling }, live()));
}

// The install as the owner left it: the agent may bridge through Across and Relay, Alice saved on
// BSC, an address saved for Base and one for Solana, and each wallet's ceiling paying them.
async function readyToSendAndBridge(fork: Fork, machine: OwnerChatMachine): Promise<void> {
  const { stores, rig } = machine;
  const settings = await stores.agents.get(agent, live());
  const limits = { ...forkLimits(fork), venues: ["pancakeswap", "across", "relay"] };
  const limited = { agentId: agent, limits, atMs: Date.now() };
  const expectedVersion = settings?.limits.version ?? 0;
  expectValue(await stores.agents.setLimits({ ...limited, expectedVersion }, live()));
  const aliceRef = evmAccountRef(fork.chain, alice);
  const baseRefOf = accountRefSchema.parse(`${baseRef}:${baseHolder}`);
  const solanaAccount = accountRefSchema.parse(`${solanaRef}:${solanaPerson}`);
  const solanaBytes = createSolanaAddressCodec().toBytes(solanaPerson);
  await save(
    machine,
    { id: entries.alice, account: aliceRef, bytes: alice.toLowerCase() },
    "alice",
  );
  const base = { id: entries.base, account: baseRefOf, bytes: baseHolder.toLowerCase() };
  await save(machine, base, "my Base address");
  const bytes = solanaBytes.ok ? toHex(solanaBytes.value) : never();
  await save(machine, { id: entries.solana, account: solanaAccount, bytes }, "my Solana address");
  const rescue = evmAccountRef(fork.chain, rig.rescue);
  const { main, bridge } = walletsOf(machine);
  await setCeiling(fork, machine, {
    wallet: main.wallet,
    contract: bscContract("across", "spoke-pool"),
    recipients: [rescue, aliceRef],
    bridged: [baseRefOf],
    capped: usdt,
  });
  await setCeiling(fork, machine, {
    wallet: bridge.wallet,
    contract: bscContract("relay", "depository"),
    recipients: [rescue],
    bridged: [],
    capped: usdc,
  });
}

// The model's answers, one a turn: the send by name; its words when the send settles, which the
// executor pushes to the runtime at once; the bridge to Base; its words when the Base bridge
// settles, which the bridge follower pushes; the bridge to Solana; and its words when that one
// settles.
function modelReplies(fork: Fork) {
  const amountOf = (token: Address, base: bigint) => ({
    asset: erc20AssetRef(fork.chain, token),
    base: base.toString(),
  });
  const send = {
    amount: amountOf(usdt, 20n * 10n ** 18n),
    to: { name },
    reason: `You asked to send 20 USDT to ${name}.`,
  };
  const toBase = {
    amount: amountOf(usdt, 10n * 10n ** 18n),
    toChain: baseRef,
    to: { entry: entries.base },
    reason: "You asked to bridge 10 USDT to your Base address.",
  };
  const toSolana = {
    amount: amountOf(usdc, 10n * 10n ** 18n),
    toChain: solanaRef,
    to: { entry: entries.solana },
    reason: "You asked to bridge 10 USDC to your Solana address.",
  };
  return [
    callsReply([{ name: "send", args: send }]),
    textReply(`The 20 USDT reached ${name}.`),
    callsReply([{ name: "bridge", args: toBase }]),
    textReply("The USDT arrived on Base."),
    callsReply([{ name: "bridge", args: toSolana }]),
    textReply("The USDC arrived on Solana."),
  ];
}

// The logs of the intent's last landed transaction on the fork that a bridge's deposit emits.
async function landedLogs(fork: Fork, machine: OwnerChatMachine, intent: Id<"int">) {
  const stored = await machine.stores.transactions.ofIntent(intent, live());
  const landed = stored.findLast(({ receipt }) => receipt !== undefined);
  const hash = (landed?.hash ?? never()) as Hex;
  const receipt = await fork.client.getTransactionReceipt({ hash });
  return { hash, logs: parseEventLogs({ abi: deposits, logs: receipt.logs }) };
}

// Follows the bridges once, as the engine's timer does, until the intent reconciles and the
// settle turn the follower woke ends; the bot then settles the card.
async function delivered(chat: Chat, step: Step, turn: number): Promise<string> {
  const { machine } = chat;
  await machine.composed.engine.followBridges(live());
  await expect(until(machine, step.intent, "reconciled")).resolves.toBe("reconciled");
  await chat.turns.turnsEnded(turn);
  await machine.bot.idle();
  return messageText(machine, step.card);
}

// "send 20 USDT to alice.bnb": the card names the name and the address it points to, the send
// lands on the fork, and the agent hears at once that it settled.
async function sendsByName(chat: Chat): Promise<void> {
  const { fork, machine } = chat;
  const before = await heldOn(fork, { address: alice, token: usdt });
  const step = await ask(chat, `send 20 USDT to ${name}`, 1);
  expect(step.card.text.split("\n")).toStrictEqual(
    expect.arrayContaining([
      `Send 20 USDT to ${name} (${alice})`,
      expect.stringMatching(new RegExp(`^${name} points to ${alice}, read at `, "u")),
    ]),
  );
  await confirm(machine);
  await expect(until(machine, step.intent, "reconciled")).resolves.toBe("reconciled");
  await chat.turns.turnsEnded(2);
  await machine.bot.idle();
  const after = await heldOn(fork, { address: alice, token: usdt });
  expect(after.token - before.token).toBe(20n * 10n ** 18n);
  expect(messageText(machine, step.card)).toMatch(
    new RegExp(`^${done} Done on chain · https://bscscan\\.com/tx/0x[0-9a-f]{64}$`, "u"),
  );
}

// "bridge 10 USDT to my Base address": the card names the entry and its address; Across's
// deposit lands for that recipient on Base, and its fill there, read from a recorded receipt
// restamped for this deposit, reconciles it.
async function bridgesToBase(chat: Chat): Promise<void> {
  const { fork, machine } = chat;
  const step = await ask(chat, "bridge 10 USDT to my Base address", 3);
  const lines = step.card.text.split("\n");
  expect(lines).toContainEqual(
    expect.stringMatching(
      new RegExp(`^Bridge 10 USDT to Base · to my Base address \\(${baseHolder}\\) · about `, "u"),
    ),
  );
  expect(lines).toContainEqual(expect.stringMatching(/ · through across$/u));
  await confirm(machine);
  await expect(until(machine, step.intent, "finalized")).resolves.toBe("finalized");
  const landed = await landedLogs(fork, machine, step.intent);
  const funds = landed.logs.find((log) => log.eventName === "FundsDeposited");
  if (funds?.eventName !== "FundsDeposited") {
    return never();
  }
  expect(funds.args.recipient).toBe(pad(baseHolder).toLowerCase());
  const fill = machine.arrivals.acrossFilled({ hash: landed.hash, ...funds.args });
  const receipt = await delivered(chat, step, 4);
  expect(receipt).toMatch(
    new RegExp(
      `^${done} Delivered on Base: my Base address \\(${baseHolder}\\) received [\\d.]+ USDT · https://basescan\\.org/tx/${fill}$`,
      "u",
    ),
  );
}

// "bridge 10 USDC to my Solana address": the card shows the base58 address; Relay's deposit
// lands from the bridge wallet, and its fill on Solana, read from a recorded transaction whose
// memo names this deposit's order, reconciles it.
async function bridgesToSolana(chat: Chat): Promise<void> {
  const { fork, machine } = chat;
  const step = await ask(chat, "bridge 10 USDC to my Solana address", 5);
  const lines = step.card.text.split("\n");
  expect(lines).toContainEqual(
    expect.stringMatching(
      new RegExp(`^Bridge 10 USDC to Solana · to my Solana address \\(${solanaPerson}\\) · `, "u"),
    ),
  );
  expect(lines).toContainEqual(expect.stringMatching(/ · through relay$/u));
  expect(lines).toContainEqual(expect.stringMatching(/^From your bridge wallet /u));
  await confirm(machine);
  await expect(until(machine, step.intent, "finalized")).resolves.toBe("finalized");
  const landed = await landedLogs(fork, machine, step.intent);
  const order = landed.logs.find((log) => log.eventName === "RelayErc20Deposit");
  if (order?.eventName !== "RelayErc20Deposit") {
    return never();
  }
  expect(order.args.from).toBe(walletsOf(machine).bridge.address);
  const bridged = await machine.stores.bridges.get(step.intent, live());
  const paid = bridged?.minOut.base ?? never();
  const fill = machine.arrivals.relayFilled({ hash: landed.hash, orderId: order.args.id, paid });
  const receipt = await delivered(chat, step, 6);
  expect(receipt).toMatch(
    new RegExp(
      `^${done} Delivered on Solana: my Solana address \\(${solanaPerson}\\) received [\\d.]+ USDC · https://explorer\\.solana\\.com/tx/${fill}$`,
      "u",
    ),
  );
}

describe("a send and two bridges from a Telegram chat on a BSC fork", () => {
  it("pays a SPACE ID name, then bridges to addresses saved for Base and Solana, each delivered", async ({
    signal,
  }) =>
    withFork(signal, async (fork) => {
      await placeName(fork, { label, holder: alice, address: alice }, signal);
      const machine = await startOwnerChatMachine(fork, signal);
      const miner = new AbortController();
      const mining = startMining(fork, miner.signal);
      const runtime = superviseRuntime(machine, {
        turns: machine.turns,
        script: { replies: modelReplies(fork) },
      });
      try {
        await fund(fork, machine);
        machine.arrivals.plainOnBase(baseHolder);
        machine.arrivals.plainOnSolana(solanaPerson);
        await readyToSendAndBridge(fork, machine);
        machine.bot.start();
        const chat = { fork, machine, turns: watchChat(machine.client, agent) };
        // The rig holds a second agent on paper, so the owner first picks the live one.
        await machine.bot.ingress.receive(ownerText(`/use ${agent}`, 1), live());
        await machine.bot.idle();

        await sendsByName(chat);
        await bridgesToBase(chat);
        await bridgesToSolana(chat);
        expect(machine.arrivals.unanswered()).toStrictEqual([]);
      } finally {
        miner.abort();
        await mining;
        await runtime.stop(AbortSignal.timeout(10_000));
        await machine.stop();
      }
    }));
});
