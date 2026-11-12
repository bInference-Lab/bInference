import assert from "node:assert/strict";
import { assertRefusesNulText, type ContractCheck, withNul } from "@binference/core/testing";
import type { NoteDraft } from "../notes/note-record.js";
import type { NoteStore, WriterFence } from "../ports.js";
import { fencedCheck, go, nthId, okValue, rejectsAborted } from "./agent-fixtures.js";

/** A fresh note store on an empty agent database, with that database's writer fence. */
export interface NoteStoreSubject {
  readonly store: NoteStore;
  readonly fence: WriterFence;
}

/** Makes a fresh subject for each check. */
export interface NoteStoreHarness {
  create(): Promise<NoteStoreSubject>;
}

// Chinese text from its code points, which only zh files may spell out: "the owner likes
// stablecoins", "check the market once every morning", "stablecoin" itself and "stable".
const chinese = (...codePoints: readonly number[]): string => String.fromCodePoint(...codePoints);
const likesStablecoins = chinese(0x4e3b, 0x4eba, 0x559c, 0x6b22, 0x7a33, 0x5b9a, 0x5e01);
const marketEachMorning = chinese(0x6bcf, 0x5929, 0x65e9, 0x4e0a, 0x770b, 0x884c, 0x60c5);
const stablecoin = chinese(0x7a33, 0x5b9a, 0x5e01);
const stable = chinese(0x7a33, 0x5b9a);

function note(text: string, agent = 1, origin: NoteDraft["origin"] = "owner"): NoteDraft {
  return { agentId: nthId("agt", agent), text, origin, atMs: 1_000 };
}

async function writeAll(subject: NoteStoreSubject, fence: number, drafts: readonly NoteDraft[]) {
  return drafts.reduce<Promise<readonly number[]>>(async (done, draft) => {
    const written = okValue(await subject.store.write({ ...draft, fence }, go()));
    return [...(await done), written.id];
  }, Promise.resolve([]));
}

// The numbers of the first agent's notes a search finds, in the order it gives them.
async function foundIds(
  subject: NoteStoreSubject,
  query: string,
  limit = 10,
): Promise<readonly number[]> {
  const found = await subject.store.search({ agentId: nthId("agt", 1), query, limit }, go());
  return found.map((record) => record.id);
}

async function keepsNotes(subject: NoteStoreSubject, fence: number): Promise<void> {
  const { store } = subject;
  const written = okValue(await store.write({ ...note("Prefers stablecoins"), fence }, go()));
  assert.deepEqual(written, {
    id: written.id,
    agentId: nthId("agt", 1),
    text: "Prefers stablecoins",
    origin: "owner",
    createdAtMs: 1_000,
    changedAtMs: 1_000,
  });
  const [second] = await writeAll(subject, fence, [
    note("A token from a group chat", 1, "untrusted"),
    note("Another agent's note", 2),
  ]);
  const agentOne = { agentId: nthId("agt", 1), limit: 10 };
  const listed = await store.list(agentOne, go());
  assert.deepEqual(
    listed.map((record) => [record.id, record.origin]),
    [
      [written.id, "owner"],
      [second, "untrusted"],
    ],
  );
  assert.deepEqual(await store.list({ ...agentOne, afterId: written.id, limit: 1 }, go()), [
    listed[1],
  ]);
}

async function searchesText(subject: NoteStoreSubject, fence: number): Promise<void> {
  const ids = await writeAll(subject, fence, [
    note(likesStablecoins),
    note(marketEachMorning),
    note("Prefers small trades on PancakeSwap"),
    note(likesStablecoins, 2),
  ]);
  const search = async (query: string): Promise<readonly number[]> =>
    (await subject.store.search({ agentId: nthId("agt", 1), query, limit: 10 }, go())).map(
      (record) => record.id,
    );
  assert.deepEqual(await search(stablecoin), [ids[0]]);
  assert.deepEqual(await search("pancake"), [ids[2]]);
  assert.deepEqual(await search("SMALL TRADES"), [ids[2]]);
  assert.deepEqual(await search("bitcoin"), []);
}

async function searchesShortQueries(subject: NoteStoreSubject, fence: number): Promise<void> {
  const ids = await writeAll(subject, fence, [
    note(likesStablecoins),
    note("Sell 50% at 2x"),
    note("Prefers small trades on PancakeSwap"),
    note(stable, 2),
  ]);
  const search = async (query: string): Promise<readonly number[]> =>
    (await subject.store.search({ agentId: nthId("agt", 1), query, limit: 10 }, go())).map(
      (record) => record.id,
    );
  assert.deepEqual(await search(stable), [ids[0]]);
  assert.deepEqual(await search("2X"), [ids[1]]);
  assert.deepEqual(await search("%"), [ids[1]]);
  assert.deepEqual(await search("_"), []);
  assert.deepEqual(await search("on"), [ids[2]]);
}

// Letters outside ASCII from their code points: a capital and a small A with diaeresis, and the
// Russian "hello" in capitals and in small letters.
const capitalUmlaut = String.fromCodePoint(0xc4);
const smallUmlaut = String.fromCodePoint(0xe4);
const helloCapitals = String.fromCodePoint(0x41f, 0x420, 0x418, 0x412, 0x415, 0x422);
const helloSmall = String.fromCodePoint(0x43f, 0x440, 0x438, 0x432, 0x435, 0x442);

async function foldsAsciiOnly(subject: NoteStoreSubject, fence: number): Promise<void> {
  const ids = await writeAll(subject, fence, [
    note(`${capitalUmlaut}RGER with the bank`),
    note(`${helloCapitals} to the market`),
  ]);
  assert.deepEqual(await foundIds(subject, `${capitalUmlaut}rger WITH`), [ids[0]]);
  assert.deepEqual(await foundIds(subject, `${smallUmlaut}rger`), []);
  assert.deepEqual(await foundIds(subject, capitalUmlaut), [ids[0]]);
  assert.deepEqual(await foundIds(subject, smallUmlaut), []);
  assert.deepEqual(await foundIds(subject, `${helloCapitals} TO`), [ids[1]]);
  assert.deepEqual(await foundIds(subject, helloSmall), []);
}

async function matchesWildcardsAsWritten(subject: NoteStoreSubject, fence: number): Promise<void> {
  const ids = await writeAll(subject, fence, [
    note("Sell 50% at 2x"),
    note("snake_case names"),
    note("snakeXcase names"),
    note("path C:\\bin\\tools"),
  ]);
  assert.deepEqual(await foundIds(subject, "50%"), [ids[0]]);
  assert.deepEqual(await foundIds(subject, "s%s"), []);
  assert.deepEqual(await foundIds(subject, "e_c"), [ids[1]]);
  assert.deepEqual(await foundIds(subject, "\\bin"), [ids[3]]);
  assert.deepEqual(await foundIds(subject, "%"), [ids[0]]);
  assert.deepEqual(await foundIds(subject, "_"), [ids[1]]);
  assert.deepEqual(await foundIds(subject, "\\"), [ids[3]]);
}

// Notes written in one millisecond list in the order they were written, and a search gives notes
// of one rank in that order too (decision 0366).
async function ordersOneInstant(subject: NoteStoreSubject, fence: number): Promise<void> {
  const ids = await writeAll(subject, fence, [
    note("buy the dip"),
    note("hold"),
    note("buy the dip"),
    note("buy the dip"),
  ]);
  const listed = await subject.store.list({ agentId: nthId("agt", 1), limit: 10 }, go());
  assert.deepEqual(
    listed.map((record) => record.id),
    ids,
  );
  const alike = [ids[0], ids[2], ids[3]];
  assert.deepEqual(await foundIds(subject, "the dip"), alike);
  assert.deepEqual(await foundIds(subject, "di"), alike);
  assert.deepEqual(await foundIds(subject, "THE DIP", 2), alike.slice(0, 2));
}

async function deletesNotes(subject: NoteStoreSubject, fence: number): Promise<void> {
  const { store } = subject;
  const [kept, removed] = await writeAll(subject, fence, [note("keep this"), note("drop this")]);
  const removal = { note: removed ?? 0, atMs: 2_000, fence };
  const deleted = okValue(await store.delete(removal, go()));
  assert.deepEqual([deleted.id, deleted.deletedAtMs], [removed, 2_000]);
  assert.deepEqual(await store.delete(removal, go()), { ok: false, error: "not_found" });
  assert.deepEqual(await store.delete({ ...removal, note: 999 }, go()), {
    ok: false,
    error: "not_found",
  });
  const listed = await store.list({ agentId: nthId("agt", 1), limit: 10 }, go());
  assert.deepEqual(
    listed.map((record) => record.id),
    [kept],
  );
  const found = await store.search({ agentId: nthId("agt", 1), query: "this", limit: 10 }, go());
  assert.deepEqual(
    found.map((record) => record.id),
    [kept],
  );
}

async function refusesStaleFence(subject: NoteStoreSubject, old: number): Promise<void> {
  const { store } = subject;
  const written = okValue(await store.write({ ...note("first"), fence: old }, go()));
  await subject.fence.raise(go());
  const fenced = { ok: false, error: "fenced" };
  assert.deepEqual(await store.write({ ...note("late"), fence: old }, go()), fenced);
  assert.deepEqual(await store.delete({ note: written.id, atMs: 1, fence: old }, go()), fenced);
  assert.deepEqual(await store.list({ agentId: nthId("agt", 1), limit: 10 }, go()), [written]);
}

async function refusesAborted({ store }: NoteStoreSubject, fence: number): Promise<void> {
  await rejectsAborted(async (options) => store.write({ ...note("hi"), fence }, options));
  await rejectsAborted(async (options) => store.delete({ note: 1, atMs: 1, fence }, options));
  const agentOne = { agentId: nthId("agt", 1), limit: 10 };
  await rejectsAborted(async (options) => store.list(agentOne, options));
  await rejectsAborted(async (options) => store.search({ ...agentOne, query: "hi" }, options));
  assert.deepEqual(await store.list(agentOne, go()), []);
}

// A note holding U+0000 is refused before anything is written (decision 0416).
async function refusesNulText(subject: NoteStoreSubject, fence: number): Promise<void> {
  const draft = note(withNul("keep 20% in stablecoins"));
  await assertRefusesNulText(async () => subject.store.write({ ...draft, fence }, go()));
  assert.deepEqual(await subject.store.list({ agentId: nthId("agt", 1), limit: 10 }, go()), []);
}

/** The contract every `NoteStore` adapter passes. */
export function noteStoreContract(harness: NoteStoreHarness): readonly ContractCheck[] {
  const create = async (): Promise<NoteStoreSubject> => harness.create();
  return [
    fencedCheck("writes notes with their origin and lists an agent's own", create, keepsNotes),
    fencedCheck(
      "finds a note by three characters or more, in Chinese and in any letter case",
      create,
      searchesText,
    ),
    fencedCheck(
      "finds a note by a query under three characters as a substring, wildcards as themselves",
      create,
      searchesShortQueries,
    ),
    fencedCheck(
      "ignores the case of ASCII letters only, so other letters match as written",
      create,
      foldsAsciiOnly,
    ),
    fencedCheck(
      "finds %, _ and \\ in a query of any length as themselves",
      create,
      matchesWildcardsAsWritten,
    ),
    fencedCheck(
      "lists and finds notes of one instant and one rank in the order they were written",
      create,
      ordersOneInstant,
    ),
    fencedCheck("removes a note from lists and searches, once", create, deletesNotes),
    fencedCheck("refuses every write made with a fence raised since", create, refusesStaleFence),
    fencedCheck("refuses a note holding U+0000 and writes nothing", create, refusesNulText),
    fencedCheck(
      "refuses every call on an aborted signal and writes nothing",
      create,
      refusesAborted,
    ),
  ];
}
