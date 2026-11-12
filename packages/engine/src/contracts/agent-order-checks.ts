import assert from "node:assert/strict";
import { accountRefSchema } from "@binference/chain";
import type { ContractCheck } from "@binference/core/testing";
import type { AddressEntryRecord } from "../agents/address-entry-record.js";
import type { AgentDraft } from "../agents/agent-record.js";
import type { AgentStore } from "../ports.js";
import { checkOn, fixtureId, inOrder, live } from "./store-fixtures.js";

// The order of each ordered read the agent store answers, pinned on rows of one millisecond
// written in an order their ids do not follow (database spec, section 6.7).

const instant = 3_000;

/** Agents created in one millisecond list by id. */
async function listsAgentsById(store: AgentStore, draft: (n: number) => AgentDraft): Promise<void> {
  await inOrder([3, 1, 2], async (n) => store.create({ ...draft(n), atMs: instant }, live()));
  const listed = await store.list(live());
  assert.deepEqual(
    listed.map(({ id }) => id),
    [1, 2, 3].map((n) => fixtureId("agt", n)),
  );
}

function entryOf(n: number): AddressEntryRecord {
  const address = `0x${n.toString(16).padStart(4, "0")}`;
  return {
    id: fixtureId("adr", n),
    agentId: fixtureId("agt", 1),
    account: accountRefSchema.parse(`fake:1:${address}`),
    recipientBytes: address,
    label: `entry ${String(n)}`,
    usableAtMs: instant,
    createdAtMs: instant,
  };
}

/** An agent's address book entries saved in one millisecond list by id. */
async function listsAddressesById(
  store: AgentStore,
  draft: (n: number) => AgentDraft,
): Promise<void> {
  assert.ok((await store.create(draft(1), live())).ok);
  await inOrder([3, 1, 2], async (n) => store.addAddress(entryOf(n), live()));
  const book = (await store.get(fixtureId("agt", 1), live()))?.addressBook;
  assert.deepEqual(book, [1, 2, 3].map(entryOf));
}

/** The agent store's checks of order among rows of one millisecond, on agent drafts by number. */
export function agentOrderChecks(
  create: () => Promise<AgentStore>,
  draft: (n: number) => AgentDraft,
): readonly ContractCheck[] {
  return [
    checkOn("lists agents created in one millisecond by id", create, async (store) =>
      listsAgentsById(store, draft),
    ),
    checkOn("lists address book entries of one millisecond by id", create, async (store) =>
      listsAddressesById(store, draft),
    ),
  ];
}
