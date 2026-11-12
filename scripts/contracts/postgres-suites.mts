import { readSource } from "./source-scan.mjs";

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
 * Every store adapter suite that runs on SQLite and not on Postgres (decision 0367: one adapter
 * code passes the same suites on both databases).
 */
export function postgresSuiteProblems(root: string, files: readonly string[]): readonly string[] {
  const tests = adapterTests(files);
  const onPostgres = new Set(
    tests
      .filter((file) => file.endsWith(".postgres.test.ts"))
      .flatMap((file) => suitesIn(root, file)),
  );
  return tests
    .filter((file) => !file.endsWith(".postgres.test.ts"))
    .flatMap((file) =>
      [...new Set(suitesIn(root, file))]
        .filter((suite) => !onPostgres.has(suite))
        .map(
          (suite) =>
            `${file}: check:contract-suites: runs ${suite} on SQLite, and no *.postgres.test.ts ` +
            `in ${storeSource} runs it on Postgres; run it beside this test on the Postgres ` +
            `test stores.`,
        ),
    );
}
