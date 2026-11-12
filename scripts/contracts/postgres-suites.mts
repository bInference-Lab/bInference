import { readSource } from "./source-scan.mjs";

/**
 * The contract suites of the agent database's stores that still run on SQLite alone, while their
 * Postgres form is built. Each leaves this list once its store's Postgres test runs it; the check
 * refuses a listed suite that already runs there, so the list only shrinks.
 */
export const agentSuitesAwaitingPostgres: ReadonlySet<string> = new Set(["chatRetentionContract"]);

const listFile = "scripts/contracts/postgres-suites.mts";
const storeSource = "packages/store/src/";
const suiteCall = /\b(\w+Contract)\(/g;

// The store package's adapter tests: its in-memory fakes run their suites apart from the databases.
function adapterTests(files: readonly string[]): readonly string[] {
  return files.filter(
    (file) =>
      file.startsWith(storeSource) &&
      file.endsWith(".test.ts") &&
      !file.startsWith(`${storeSource}fakes/`),
  );
}

function suitesIn(root: string, file: string): readonly string[] {
  return [...readSource(root, file).matchAll(suiteCall)].map((match) => match[1] ?? "");
}

/**
 * Every store adapter suite that runs on SQLite and not on Postgres, unless it waits on the list
 * above, and every suite on the list that runs on Postgres already (decision 0367: one adapter
 * code passes the same suites on both databases).
 */
export function postgresSuiteProblems(root: string, files: readonly string[]): readonly string[] {
  const tests = adapterTests(files);
  const onPostgres = new Set(
    tests
      .filter((file) => file.endsWith(".postgres.test.ts"))
      .flatMap((file) => suitesIn(root, file)),
  );
  const missing = tests
    .filter((file) => !file.endsWith(".postgres.test.ts"))
    .flatMap((file) =>
      [...new Set(suitesIn(root, file))]
        .filter((suite) => !onPostgres.has(suite) && !agentSuitesAwaitingPostgres.has(suite))
        .map(
          (suite) =>
            `${file}: check:contract-suites: runs ${suite} on SQLite, and no *.postgres.test.ts ` +
            `in ${storeSource} runs it on Postgres; run it beside this test on the Postgres ` +
            `test stores.`,
        ),
    );
  const stale = [...agentSuitesAwaitingPostgres]
    .filter((suite) => onPostgres.has(suite))
    .map(
      (suite) =>
        `${listFile}: check:contract-suites: ${suite} runs on Postgres now; take it off ` +
        `agentSuitesAwaitingPostgres.`,
    );
  return [...missing, ...stale];
}
