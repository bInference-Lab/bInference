import { err, idSchema } from "@binference/core";
import { createManualClock, createSeededRandom } from "@binference/core/testing";
import { fileLimits } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { createMemoryFiles, memoryFilePlaces } from "../fakes/memory-files.js";
import type { MachineFiles } from "../files/ports.js";
import { expectOk, testAgent } from "../intents/test-intents.js";
import { testCall, testCallers } from "../operations/test-engine.js";
import type { EnginePush } from "../pushes/engine-push.js";
import { createRunningTurns } from "./running-turns.js";
import { createSentFileHandlers } from "./sent-files.js";

const turn = idSchema("trn").parse("trn_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const runtime = testCallers.runtime;
const { workspace, home, state } = memoryFilePlaces;
const csv = `${workspace}/reports/trades.csv`;
const pdf = `${home}/docs/statement.pdf`;
// A file two parts and a byte long, so a surface reads it in three parts.
const large = "x".repeat(fileLimits.sentFilePartBytes * 2 + 1);

function setUp(given: { readonly workspaceOnly?: boolean; readonly files?: MachineFiles } = {}) {
  const clock = createManualClock(Date.UTC(2026, 10, 7, 12));
  const turns = createRunningTurns();
  turns.startRuntime(idSchema("tok").parse(runtime.credential));
  const pushes: EnginePush[] = [];
  const files =
    given.files ??
    createMemoryFiles({ [csv]: "date,side\n", [pdf]: "%PDF-1.7", [`${home}/big.log`]: large });
  const settings = () => ({
    workspaceOnly: given.workspaceOnly ?? false,
    patchWorkspaceOnly: true,
  });
  const handlers = createSentFileHandlers({
    turns,
    clock,
    random: createSeededRandom(3),
    publish: (push) => pushes.push(push),
    sentFiles: { files, settings },
  });
  const send = async (paths: readonly string[], caller = runtime) =>
    handlers["file/send"](
      testCall({ agent: testAgent, turn, paths, caption: "The files." }, caller),
    );
  const fetch = async (file: string, offset?: number) =>
    handlers["file/fetch"](
      testCall({ agent: testAgent, file, ...(offset === undefined ? {} : { offset }) }),
    );
  return { handlers, pushes, send, fetch, clock };
}

describe("the files the agent sends the owner", () => {
  it("pushes files on the machine to the chat by name and path, relative paths in the workspace", async () => {
    const test = setUp();
    const sent = expectOk(await test.send(["reports/trades.csv", "~/docs/statement.pdf"]));
    expect(sent.files.map(({ name, path, bytes }) => ({ name, path, bytes }))).toStrictEqual([
      { name: "trades.csv", path: csv, bytes: 10 },
      { name: "statement.pdf", path: pdf, bytes: 8 },
    ]);
    expect(test.pushes).toStrictEqual([
      {
        topic: `chat:${testAgent}`,
        kind: "chat/files",
        data: { agent: testAgent, turn, caption: "The files.", files: sent.files },
      },
    ]);
  });

  it("answers a sent file's bytes in parts, by its id, and nothing past its end", async () => {
    const test = setUp();
    const [file] = expectOk(await test.send([`${home}/big.log`])).files;
    const id = String(file?.file);
    const parts = [expectOk(await test.fetch(id)), expectOk(await test.fetch(id, 524_288))];
    const last = expectOk(await test.fetch(id, 1_048_576));
    expect([...parts, last].map(({ offset, next }) => [offset, next])).toStrictEqual([
      [0, 524_288],
      [524_288, 1_048_576],
      [1_048_576, undefined],
    ]);
    const joined = [...parts, last]
      .map(({ data }) => Buffer.from(data, "base64").toString())
      .join("");
    expect(joined).toBe(large);
    expect(await test.fetch(id, 1_048_577)).toStrictEqual(err("protocol.bad_args"));
  });

  it("refuses them all when one cannot be sent, and pushes nothing", async () => {
    const test = setUp();
    const workspaceOnly = setUp({ workspaceOnly: true });
    expect([
      await test.send([csv, `${state}/engine.sqlite`]),
      await test.send([csv, `${home}/gone.txt`]),
      await workspaceOnly.send([pdf]),
    ]).toStrictEqual([err("file.walled"), err("file.not_found"), err("file.outside_workspace")]);
    expect([...test.pushes, ...workspaceOnly.pushes]).toStrictEqual([]);
  });

  it("answers only the runtime the engine runs now, and no file of another agent or unknown id", async () => {
    const test = setUp();
    const other = idSchema("agt").parse("agt_0190f1c2-3a4b-7c5d-8e6f-0000000000ff");
    const [file] = expectOk(await test.send([csv])).files;
    const id = String(file?.file);
    expect([
      await test.send([csv], testCallers.cli),
      await test.handlers["file/fetch"](testCall({ agent: other, file: id })),
      await test.fetch("ffffffffffffffff"),
    ]).toStrictEqual([err("auth.scope"), err("file.not_found"), err("file.not_found")]);
  });
});
