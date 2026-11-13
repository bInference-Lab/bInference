import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import { type ListedMcpServer, listedMcpServersSchema } from "../listed-mcp/listing.schema.js";
import type { ListedMcpSource } from "../listed-mcp/ports.js";

/** A fresh listing source, with a way to change what it holds as its catalog would. */
export interface ListedMcpSourceSubject {
  readonly source: ListedMcpSource;
  /** Puts these listings in force, as a new catalog read or a switch of an agent would. */
  readonly change: (next: readonly ListedMcpServer[]) => Promise<void>;
}

/** Makes a fresh subject for each check, holding the listings it is given. */
export interface ListedMcpSourceHarness {
  create(initial: readonly ListedMcpServer[]): Promise<ListedMcpSourceSubject>;
}

async function answersWhatIsInForce(
  harness: ListedMcpSourceHarness,
  servers: readonly ListedMcpServer[],
): Promise<void> {
  const { source, change } = await harness.create(servers);
  assert.deepEqual(source.current(), servers);
  assert.ok(listedMcpServersSchema.safeParse(source.current()).success);
  await change([]);
  assert.deepEqual(source.current(), []);
}

async function callsWatchersOnEachChange(
  harness: ListedMcpSourceHarness,
  servers: readonly ListedMcpServer[],
): Promise<void> {
  const { source, change } = await harness.create([]);
  const heard: (readonly ListedMcpServer[])[] = [];
  const stop = source.watch(() => heard.push(source.current()));
  await change(servers);
  await change([]);
  stop();
  await change(servers);
  assert.deepEqual(heard, [servers, []]);
}

/**
 * The contract every {@link ListedMcpSource} keeps (runtime spec, section 5.5): `current` answers
 * the listings in force, each one the listing schema takes, and `watch` hears every change until
 * the function it answered is called. `servers` is a valid set of listings to hold.
 */
export function listedMcpSourceContract(
  harness: ListedMcpSourceHarness,
  servers: readonly ListedMcpServer[],
): readonly ContractCheck[] {
  return [
    {
      name: "answers the listings in force",
      run: async () => answersWhatIsInForce(harness, servers),
    },
    {
      name: "calls each watcher after every change until it stops",
      run: async () => callsWatchersOnEachChange(harness, servers),
    },
  ];
}
