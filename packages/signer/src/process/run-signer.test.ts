import { PassThrough, Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { formatAgentKey } from "../agent-key/agent-key-text.js";
import { createP256KeyPair } from "../keys/p256-key-pair.js";
import { fixtureSettings } from "../testing/sign-fixtures.js";
import { runSigner } from "./run-signer.js";

const program = "/opt/binference/signer-process.mjs";
const agentKey = createP256KeyPair();

// A permission model that holds every scope until it is dropped; `keep` names what a drop leaves.
function permissionModel(keep: readonly string[] = []) {
  const dropped = new Set<string>();
  const held = (scope: string): boolean =>
    keep.includes(scope) || !dropped.has(scope.split(".")[0] ?? scope);
  const permission: NodeJS.ProcessPermission = {
    has: (scope, reference) => held(reference === undefined ? scope : `${scope}:${reference}`),
    drop: (scope) => {
      dropped.add(scope);
    },
  };
  return { permission, dropped };
}

async function* inputOf(...lines: readonly string[]): AsyncGenerator<Buffer> {
  yield Buffer.from(lines.map((line) => `${line}\n`).join(""));
}

async function run(permission: NodeJS.ProcessPermission | undefined) {
  const output = new PassThrough();
  const fault = await runSigner({
    permission,
    program,
    input: inputOf(
      JSON.stringify(fixtureSettings),
      formatAgentKey(agentKey).reveal(),
      JSON.stringify({ id: "a", kind: "publicKey" }),
    ),
    output,
  });
  output.end();
  const text = (await output.toArray()).join("");
  return { fault, lines: text.split("\n").filter((line) => line.length > 0) };
}

describe("running the signer", () => {
  it("drops every scope of the permission model, then serves the engine", async () => {
    const model = permissionModel();
    const { fault, lines } = await run(model.permission);

    expect(fault).toBeUndefined();
    expect([...model.dropped].toSorted()).toStrictEqual([
      "addon",
      "child",
      "fs",
      "inspector",
      "net",
      "wasi",
      "worker",
    ]);
    expect(lines).toStrictEqual([
      JSON.stringify({ id: "a", ok: true, publicKey: agentKey.publicKey }),
    ]);
  });

  it.each([
    ["without the permission model", undefined],
    ["when network access survives the drop", permissionModel(["net"]).permission],
    ["when it can still read its own program", permissionModel([`fs.read:${program}`]).permission],
  ])("refuses to run %s", async (_case, permission) => {
    await expect(run(permission)).resolves.toStrictEqual({
      fault: "signer.not_sealed",
      lines: ['{"fault":"signer.not_sealed"}'],
    });
  });

  it("fails when its output refuses a line", async () => {
    const broken = new Writable({
      write: (_chunk, _encoding, done) => {
        done(new Error("the engine closed the pipe"));
      },
    });
    // The stream reports the failure as an event too; the signer process lets that end it.
    broken.on("error", () => undefined);

    await expect(
      runSigner({ permission: undefined, program, input: inputOf(), output: broken }),
    ).rejects.toThrow("the engine closed the pipe");
  });
});
