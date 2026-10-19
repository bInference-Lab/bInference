import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import { type AccountRef, accountRefParts } from "../caip/account-ref.js";
import { type AssetRef, assetRefParts } from "../caip/asset-ref.js";
import type { ChainRef } from "../caip/chain-ref.js";
import type { LaunchesFound, LaunchLog } from "../venues/launch-logs.js";
import type { LaunchReader } from "../venues/ports.js";

/** A launchpad under test and transactions' logs recorded from its chain. */
export interface LaunchReaderSubject {
  readonly reader: LaunchReader;
  readonly chain: ChainRef;
  /** The launchpad's declared contracts on the chain, by their registry names. */
  readonly contracts: Readonly<Record<string, AccountRef>>;
  /** A launch transaction's logs, and the token it created. */
  readonly launch: { readonly logs: readonly LaunchLog[]; readonly token: AssetRef };
  /** A transaction's logs of the same events that created no token of the launchpad. */
  readonly other: readonly LaunchLog[];
  /** A contract of the chain the launchpad does not know. */
  readonly stranger: AccountRef;
}

/** Makes a fresh {@link LaunchReaderSubject} for each check. */
export interface LaunchReaderHarness {
  create(): LaunchReaderSubject;
}

const accountOn = (chain: ChainRef, account: AccountRef): boolean =>
  accountRefParts(account).chain === chain;

// The launch logs with each log written by another contract, as anyone may write any event.
function forged(logs: readonly LaunchLog[], stranger: AccountRef): readonly LaunchLog[] {
  return logs.map((log) => ({ ...log, emitter: stranger }));
}

// The tokens and creators a reading found, to compare two readings.
const foundKeys = (found: LaunchesFound): readonly string[] =>
  found.launches.map(({ token, creator }) => `${token} ${creator}`);

// The launch's token, its creator, quote asset and insiders on its chain, the insiders each once.
function readsTheLaunch({ reader, chain, contracts, launch }: LaunchReaderSubject): void {
  const found = reader.readLaunches({ chain, contracts, logs: launch.logs });
  assert.deepEqual(
    found.launches.map(({ token }) => token),
    [launch.token],
  );
  const [read] = found.launches;
  assert.ok(read !== undefined);
  assert.ok(accountOn(chain, read.creator));
  assert.equal(assetRefParts(read.quoteAsset).chain, chain);
  assert.equal(new Set(read.insiders).size, read.insiders.length);
  assert.ok(read.insiders.every((insider) => accountOn(chain, insider)));
  assert.ok(launch.logs.some(({ index }) => index === read.index));
}

/** The contract every `LaunchReader` passes. */
export function launchReaderContract(harness: LaunchReaderHarness): readonly ContractCheck[] {
  return [
    {
      name: "declares at least one event, each once",
      run: async () => {
        const { reader } = harness.create();
        assert.ok(reader.launchEvents.length > 0);
        assert.equal(new Set(reader.launchEvents).size, reader.launchEvents.length);
      },
    },
    {
      name: "reads a launch's token, creator, quote asset and insiders on its chain, once each",
      run: async () => readsTheLaunch(harness.create()),
    },
    {
      name: "reads the same launches from the same logs again",
      run: async () => {
        const { reader, chain, contracts, launch } = harness.create();
        const request = { chain, contracts, logs: launch.logs };
        assert.deepEqual(
          foundKeys(reader.readLaunches(request)),
          foundKeys(reader.readLaunches(request)),
        );
      },
    },
    {
      name: "reads no launch from a transaction that created none",
      run: async () => {
        const { reader, chain, contracts, other } = harness.create();
        assert.deepEqual(reader.readLaunches({ chain, contracts, logs: other }).launches, []);
      },
    },
    {
      name: "believes no create event that another contract wrote",
      run: async () => {
        const { reader, chain, contracts, launch, stranger } = harness.create();
        const logs = forged(launch.logs, stranger);
        assert.deepEqual(reader.readLaunches({ chain, contracts, logs }), {
          launches: [],
          changes: [],
        });
      },
    },
  ];
}
