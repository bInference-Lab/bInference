import assert from "node:assert/strict";
import {
  accountRefSchema,
  assetRefSchema,
  chainRefSchema,
  isTxHash,
  type TxHash,
} from "@binference/chain";
import type { ContractCheck } from "@binference/core/testing";
import type { BridgeDraft } from "../bridges/bridge-record.js";
import { answerOf, assertOneWon, conflict, race, settled } from "./money-race-runs.js";
import { checkOn, fixtureHash, fixtureId, live } from "./store-fixtures.js";
import { firstWriter, type KeyRaceSubject } from "./store-key-race-runs.js";
import { ruleDraft, ruleSecretHash } from "./webhook-rule-fixtures.js";

// The key races of the install, bridge, daily summary and webhook stores (decision 0413), which
// `storeKeyRaces` runs.

// An answer that is not a refusal, as the one word the races compare.
const wordOf = <Answer>(
  answer: Answer | typeof conflict,
  word: (value: Answer) => string,
): string => (answer === conflict ? conflict : word(answer));

/** Writers that propose their own install ids at once all answer the one stored. */
async function keepsOneInstallId(subject: KeyRaceSubject): Promise<void> {
  const answers = await race(subject, async ({ install }, index) =>
    settled(install.installId({ id: fixtureId("ins", index + 1), atMs: index }, live())),
  );
  const stored = await firstWriter(subject).install.installId(
    { id: fixtureId("ins", 99), atMs: 99 },
    live(),
  );
  for (const answer of answers) {
    assert.ok(answer === conflict || answer === stored, String(answer));
  }
}

function txOf(n: number): TxHash {
  const hash = `0x${n.toString(16).padStart(64, "0")}`;
  return isTxHash(hash) ? hash : assert.fail("not a hash");
}

function bridgeOf(subject: KeyRaceSubject, n: number): BridgeDraft {
  return {
    intentId: subject.intentIds[0],
    venue: "fake-cross",
    depositTx: txOf(n),
    toChain: chainRefSchema.parse("fake:2"),
    recipient: accountRefSchema.parse("fake:2:0x000000f3"),
    sent: { asset: assetRefSchema.parse("fake:1/erc20:0x00000005"), base: 10n },
    minOut: { asset: assetRefSchema.parse("fake:2/erc20:0x00000006"), base: 9n },
    sentAtMs: 1_000,
  };
}

/** Writers that open one intent's bridge at once all answer the one bridge stored. */
async function opensOneBridge(subject: KeyRaceSubject): Promise<void> {
  const answers = await race(subject, async ({ bridges }, index) => {
    const opened = await settled(bridges.open(bridgeOf(subject, index + 1), live()));
    return wordOf(opened, (bridge) => bridge.depositTx);
  });
  const stored = await firstWriter(subject).bridges.get(subject.intentIds[0], live());
  assert.ok(stored !== undefined);
  for (const answer of answers) {
    assert.ok([conflict, stored.depositTx].includes(answer), answer);
  }
}

/** Writers that claim one agent's summary of one date at once store it once. */
async function claimsOneSummary(subject: KeyRaceSubject): Promise<void> {
  const answers = await race(subject, async ({ summaries }, index) => {
    const record = { agentId: subject.agentId, date: "2026-11-12", atMs: index } as const;
    return answerOf(await settled(summaries.claim({ ...record, outcome: "sent" }, live())));
  });
  assertOneWon(answers, "claimed");
}

/** Writers that create one rule id at once store it once; every other create is `exists`. */
async function createsOneRule(subject: KeyRaceSubject): Promise<void> {
  const answers = await race(subject, async ({ rules }, index) => {
    const draft = { ...ruleDraft(subject, 1), atMs: 100 + index };
    return answerOf(await settled(rules.create(draft, live())));
  });
  assertOneWon(answers, "exists");
}

/** Writers that take one alert at once accept it once; every other take is a repeat. */
async function acceptsOneAlert(subject: KeyRaceSubject): Promise<void> {
  const rule = fixtureId("whr", 1);
  const secretHash = ruleSecretHash(1);
  await subject.plant({ id: rule, secretHash, state: "active", ratePerMinute: 60 });
  const answers = await race(subject, async ({ webhookAlerts }) => {
    const draft = {
      rule,
      secretHash,
      body: { text: "buy" },
      bodyHash: fixtureHash("buy"),
      receivedAtMs: 5_000,
    };
    return wordOf(await settled(webhookAlerts.take(draft, live())), ({ kind }) => kind);
  });
  assertOneWon(
    answers.map((kind) => (kind === "accepted" ? "ok" : kind)),
    "repeat",
  );
}

/** The key races of the install, bridge, daily summary and webhook stores. */
export function installAndWebhookKeyRaces(
  create: () => Promise<KeyRaceSubject>,
): readonly ContractCheck[] {
  return [
    checkOn("keeps the first install id of racing proposals", create, keepsOneInstallId),
    checkOn("opens an intent's bridge once", create, opensOneBridge),
    checkOn("claims an agent's summary of a date once", create, claimsOneSummary),
    checkOn("creates a webhook rule id once", create, createsOneRule),
    checkOn("accepts one of identical alerts taken at once", create, acceptsOneAlert),
  ];
}
