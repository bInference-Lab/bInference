import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import { type AccountRef, accountRefParts } from "../caip/account-ref.js";
import type { NameResolver } from "../names/ports.js";

/** A name and the account it points to, in the resolver's canonical form. */
export interface NamedAccount {
  /** The name, already normalized. */
  readonly name: string;
  readonly address: AccountRef;
}

/**
 * A name resolver under test: `person` points to a plain account whose reverse record names it,
 * `contract` to an account holding code; nobody registered `unregistered`; `malformed` carries the
 * suffix but does not normalize. `move` points `person` to `elsewhere`, another plain account.
 */
export interface NameResolverSubject {
  readonly resolver: NameResolver;
  readonly person: NamedAccount;
  readonly contract: NamedAccount;
  readonly unregistered: string;
  readonly malformed: string;
  readonly elsewhere: AccountRef;
  move(to: AccountRef): Promise<void>;
}

/** Makes a fresh {@link NameResolverSubject} for each check. */
export interface NameResolverHarness {
  create(): Promise<NameResolverSubject>;
}

const live = (): { readonly signal: AbortSignal } => ({ signal: new AbortController().signal });

async function resolvesPerson(harness: NameResolverHarness): Promise<void> {
  const { resolver, person } = await harness.create();
  const answer = await resolver.resolve(person.name, live());
  assert.deepEqual(answer, { kind: "found", ...person, reverse: { kind: "matches" } });
  assert.equal(accountRefParts(person.address).chain, resolver.chain);
  assert.ok(person.name.endsWith(resolver.suffix));
}

async function normalizes(harness: NameResolverHarness): Promise<void> {
  const { resolver, person } = await harness.create();
  const answer = await resolver.resolve(person.name.toUpperCase(), live());
  assert.equal(answer.kind, "found");
  assert.equal(answer.name, person.name);
  assert.equal(answer.address, person.address);
}

async function refusesContract(harness: NameResolverHarness): Promise<void> {
  const { resolver, contract } = await harness.create();
  assert.deepEqual(await resolver.resolve(contract.name, live()), {
    kind: "contract",
    ...contract,
  });
}

async function findsNothing(harness: NameResolverHarness): Promise<void> {
  const { resolver, unregistered } = await harness.create();
  assert.deepEqual(await resolver.resolve(unregistered, live()), {
    kind: "not_found",
    name: unregistered,
  });
}

async function refusesMalformed(harness: NameResolverHarness): Promise<void> {
  const { resolver, person, malformed } = await harness.create();
  const otherSuffix = `${person.name.slice(0, -resolver.suffix.length)}.example`;
  const texts = [malformed, otherSuffix, resolver.suffix, ""];
  const answers = await Promise.all(texts.map(async (text) => resolver.resolve(text, live())));
  assert.deepEqual(
    answers,
    texts.map(() => ({ kind: "malformed" })),
  );
}

async function readsAgain(harness: NameResolverHarness): Promise<void> {
  const subject = await harness.create();
  const { resolver, person, elsewhere } = subject;
  await resolver.resolve(person.name, live());
  await subject.move(elsewhere);
  const answer = await resolver.resolve(person.name, live());
  assert.equal(answer.kind, "found");
  assert.equal(answer.address, elsewhere);
}

async function stopsOnAbort(harness: NameResolverHarness): Promise<void> {
  const { resolver, person } = await harness.create();
  const reason = new Error("stopped");
  await assert.rejects(
    resolver.resolve(person.name, { signal: AbortSignal.abort(reason) }),
    reason,
  );
}

/** The contract every `NameResolver` passes. */
export function nameResolverContract(harness: NameResolverHarness): readonly ContractCheck[] {
  return [
    {
      name: "resolves a person's name to its account, with the reverse record naming it",
      run: async () => resolvesPerson(harness),
    },
    {
      name: "normalizes a name before it resolves it",
      run: async () => normalizes(harness),
    },
    {
      name: "answers a name that points to a contract as a contract",
      run: async () => refusesContract(harness),
    },
    {
      name: "answers a name nobody registered as not found",
      run: async () => findsNothing(harness),
    },
    {
      name: "answers text under another suffix, or that does not normalize, as malformed",
      run: async () => refusesMalformed(harness),
    },
    {
      name: "reads the record again on every call: a moved name answers its new address",
      run: async () => readsAgain(harness),
    },
    { name: "refuses to read on an aborted signal", run: async () => stopsOnAbort(harness) },
  ];
}
