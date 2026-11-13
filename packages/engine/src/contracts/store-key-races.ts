import assert from "node:assert/strict";
import { accountRefSchema } from "@binference/chain";
import type { ContractCheck } from "@binference/core/testing";
import type { LaunchTicketRecord } from "../access/launch-ticket.js";
import type { AddressEntryRecord } from "../agents/address-entry-record.js";
import { testAgentDraft } from "../intents/test-intents.js";
import { answerOf, assertOneWon, conflict, race, settled } from "./money-race-runs.js";
import { checkOn, fixtureHash, fixtureId, inOrder, live } from "./store-fixtures.js";
import { installAndWebhookKeyRaces } from "./store-key-race-checks.js";
import { firstWriter, type KeyRaceHarness, type KeyRaceSubject } from "./store-key-race-runs.js";

// Writers that insert one key their caller chose at once (decision 0413), on the stores outside
// the money stores: the first to commit stores it, and every other gets the port's own answer,
// never a broken constraint, whether it read the key first or met it on a rerun.

/** Writers that create one agent id, or one name under their own ids, store it once. */
async function createsOneAgent(subject: KeyRaceSubject): Promise<void> {
  const byId = await race(subject, async ({ agents }, index) => {
    const draft = testAgentDraft({ id: fixtureId("agt", 7), name: `seven ${String(index)}` });
    return answerOf(await settled(agents.create(draft, live())));
  });
  assertOneWon(byId, "exists");
  const byName = await race(subject, async ({ agents }, index) => {
    const draft = testAgentDraft({ id: fixtureId("agt", 10 + index), name: "taken" });
    return answerOf(await settled(agents.create(draft, live())));
  });
  assertOneWon(byName, "name_taken");
  const listed = await firstWriter(subject).agents.list(live());
  assert.equal(listed.filter(({ name }) => name === "taken").length, 1);
}

function entryOf(subject: KeyRaceSubject, n: number, address: string): AddressEntryRecord {
  return {
    id: fixtureId("adr", n),
    agentId: subject.agentId,
    account: accountRefSchema.parse(`fake:1:${address}`),
    recipientBytes: address,
    label: `entry ${String(n)}`,
    usableAtMs: 1,
    createdAtMs: 1,
  };
}

/** Writers that save one entry id, or one account under their own ids, store it once. */
async function savesOneAddress(subject: KeyRaceSubject): Promise<void> {
  const byId = await race(subject, async ({ agents }, index) => {
    const entry = entryOf(subject, 1, `0x${(0xa0 + index).toString(16)}`);
    return answerOf(await settled(agents.addAddress(entry, live())));
  });
  assertOneWon(byId, "exists");
  const byAccount = await race(subject, async ({ agents }, index) => {
    const entry = entryOf(subject, 10 + index, "0xbb");
    return answerOf(await settled(agents.addAddress(entry, live())));
  });
  assertOneWon(byAccount, "saved");
}

/** Writers that add one token, device or pairing code store each once; the others `exists`. */
async function addsOneAccessKey(subject: KeyRaceSubject): Promise<void> {
  const tokens = await race(subject, async ({ access }, index) => {
    const token = {
      id: fixtureId("tok", 1),
      label: `token ${String(index)}`,
      kind: "mcp",
      scopes: ["read"],
      secretHash: fixtureHash(`secret ${String(index)}`),
      createdAtMs: 1,
    } as const;
    return answerOf(await settled(access.addToken(token, live())));
  });
  assertOneWon(tokens, "exists");
  const devices = await race(subject, async ({ access }, index) => {
    const device = {
      id: fixtureId("dev", 1),
      label: `device ${String(index)}`,
      alg: "p256",
      publicKey: `BKey${String(index)}`,
      createdAtMs: 1,
    } as const;
    return answerOf(await settled(access.addDevice(device, live())));
  });
  assertOneWon(devices, "exists");
  const codes = await race(subject, async ({ access }, index) => {
    const code = { codeHash: fixtureHash("482913"), expiresAtMs: 10_000 + index };
    return answerOf(await settled(access.addPairCode(code, live())));
  });
  assertOneWon(codes, "exists");
}

/** Writers that claim one Mini App launch, each with a ticket of its own, claim it once. */
async function claimsOneLaunch(subject: KeyRaceSubject): Promise<void> {
  const tickets = subject.writers.map((_, index): LaunchTicketRecord => ({
    ticketHash: fixtureHash(`ticket ${String(index)}`),
    userId: 279_058_397,
    issuedAtMs: 1_000,
    expiresAtMs: 301_000,
  }));
  await inOrder(tickets, async (ticket) =>
    firstWriter(subject).access.addLaunchTicket(ticket, live()),
  );
  const claims = await race(subject, async ({ access }, index) => {
    const ticket = tickets[index];
    assert.ok(ticket !== undefined);
    const claim = { launchHash: fixtureHash("launch"), userId: ticket.userId, atMs: 2_000 };
    return settled(
      access.claimLaunch({ ...claim, ticketHash: ticket.ticketHash, sinceMs: 0 }, live()),
    );
  });
  assertOneWon(
    claims.map((answer) => (answer === "claimed" ? "ok" : answer)),
    "seen",
  );
}

/**
 * Writers that remember one key, start one key, or admit one source key keep the first; the others
 * repeat it, or find the key unfinished.
 */
async function keepsOneIngressKey(subject: KeyRaceSubject): Promise<void> {
  const remembered = await race(subject, async ({ idempotency }, index) => {
    const entry = {
      credential: fixtureId("tok", 1),
      op: "intent/propose",
      key: "0190f1c2-3a4b-7c5d-8e6f-000000000001",
      argsHash: fixtureHash("args"),
      result: { writer: index },
      atMs: 1_000,
    };
    const recall = await settled(idempotency.remember(entry, live()));
    return recall === conflict ? conflict : recall.kind;
  });
  assertOneWon(
    remembered.map((kind) => (kind === "new" ? "ok" : kind)),
    "repeat",
  );
  const started = await race(subject, async ({ idempotency }, index) => {
    const mark = {
      credential: fixtureId("tok", 1),
      op: "intent/propose",
      key: "0190f1c2-3a4b-7c5d-8e6f-000000000002",
      argsHash: fixtureHash("args"),
      atMs: 1_000 + index,
    };
    const start = await settled(idempotency.start(mark, live()));
    return start === conflict ? conflict : start.kind;
  });
  assertOneWon(
    started.map((kind) => (kind === "started" ? "ok" : kind)),
    "unfinished",
  );
  const admitted = await race(subject, async ({ inbox }, index) => {
    const draft = {
      source: "telegram",
      sourceKey: "tg:1:1",
      payload: index,
      receivedAtMs: 1,
    } as const;
    const admission = await settled(inbox.admit(draft, live()));
    return admission === conflict ? conflict : admission.kind;
  });
  assertOneWon(
    admitted.map((kind) => (kind === "new" ? "ok" : kind)),
    "repeat",
  );
}

/** The checks every set of engine stores passes under racing writers of one key. */
export function storeKeyRaces(harness: KeyRaceHarness): readonly ContractCheck[] {
  const create = async (): Promise<KeyRaceSubject> => harness.create();
  return [
    checkOn("creates an agent id and an agent name once", create, createsOneAgent),
    checkOn("saves an address book entry and an account once", create, savesOneAddress),
    checkOn("adds a token, a device and a pairing code once", create, addsOneAccessKey),
    checkOn("claims a Mini App launch once", create, claimsOneLaunch),
    checkOn("remembers and starts a call and admits an event once", create, keepsOneIngressKey),
    ...installAndWebhookKeyRaces(create),
  ];
}
