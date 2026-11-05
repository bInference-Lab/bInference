import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { TestProject } from "vitest/node";

const run = promisify(execFile);

/** The image the Postgres tests run on, pinned by digest: the oldest Postgres the store supports. */
export const testPostgresImage =
  "docker.io/library/postgres:17.11@sha256:653186fe15006c099d2fb3bc1d8461c1dee9d036c43f2e5fdaf4f22e5e601876";

const urlVariable = "BINFERENCE_TEST_POSTGRES_URL";
const switchVariable = "BINFERENCE_TEST_POSTGRES";
const container = "binference-test-postgres";
const dockerTimeoutMs = 60_000;

async function docker(args: readonly string[]): Promise<string> {
  const { stdout } = await run("docker", [...args], { timeout: dockerTimeoutMs });
  return stdout.trim();
}

async function dockerAnswers(): Promise<boolean> {
  try {
    await docker(["info", "--format", "{{.ServerVersion}}"]);
    return true;
  } catch {
    return false;
  }
}

// The server listens on TCP only after its first-start setup, so the wait checks 127.0.0.1. Its
// data lives in memory without fsync: a test server keeps nothing.
async function startContainer(): Promise<string> {
  await run("docker", ["rm", "--force", container], { timeout: dockerTimeoutMs }).catch(() => "");
  await docker(
    [
      ["run", "--detach", "--rm", "--name", container, "--publish", "127.0.0.1::5432"],
      ["--env", "POSTGRES_HOST_AUTH_METHOD=trust", "--tmpfs", "/var/lib/postgresql/data"],
      [testPostgresImage, "-c", "fsync=off", "-c", "max_connections=300"],
    ].flat(),
  );
  await run(
    "sh",
    [
      "-c",
      `for i in $(seq 300); do docker exec ${container} pg_isready -q -h 127.0.0.1 && exit 0; sleep 0.1; done; exit 1`,
    ],
    { timeout: dockerTimeoutMs },
  );
  const port = (await docker(["port", container, "5432/tcp"])).split(":").at(-1) ?? "";
  return `postgres://postgres@127.0.0.1:${port}/postgres`;
}

/**
 * The Postgres project's global setup. It gives the tests `inject("postgres")`: the server that
 * BINFERENCE_TEST_POSTGRES_URL names, or else one container it starts on Docker and removes at the
 * end. With neither, or with BINFERENCE_TEST_POSTGRES set to `off`, it gives an empty URL and says
 * why the Postgres tests skip.
 */
function skip(project: TestProject, why: string): () => Promise<void> {
  project.provide("postgres", "");
  project.vitest.logger.warn(`Skipping the Postgres tests: ${why}`);
  return async () => undefined;
}

export async function setup(project: TestProject): Promise<() => Promise<void>> {
  const named = process.env[urlVariable] ?? "";
  if (named !== "") {
    project.provide("postgres", named);
    return async () => undefined;
  }
  if (process.env[switchVariable] === "off") {
    return skip(project, `${switchVariable} is off; a CI job of their own runs them.`);
  }
  if (!(await dockerAnswers())) {
    return skip(
      project,
      `set ${urlVariable} to a Postgres 17 server, or start Docker so they run on ${testPostgresImage}.`,
    );
  }
  project.provide("postgres", await startContainer());
  project.vitest.logger.log(`Postgres tests: ${testPostgresImage} in container ${container}.`);
  return async () => {
    await docker(["rm", "--force", container]);
  };
}
