import assert from "node:assert/strict";
import type { WorkspaceFiles } from "../ports.js";
import { err, ok } from "../result.js";
import type { WorkspacePlace } from "../workspace/workspace-place.js";
import type { ContractCheck } from "./contract-check.js";

/** Makes an empty store for each check; a store on a real folder makes a new folder each time. */
export interface WorkspaceFilesHarness {
  create(): Promise<WorkspaceFiles>;
}

const signal = (): AbortSignal => new AbortController().signal;
const agent = "agt_0190f1c2-3a4b-7c5d-8e6f-000000000001";
const other = "agt_0190f1c2-3a4b-7c5d-8e6f-000000000002";
const at = (file: string, owner = agent) => ({ agent: owner, file });
const invalid = { code: "platform.workspace_name_invalid" };
// Text a person wrote: two lines, letters past ASCII and a trailing newline, kept byte for byte.
const rules = "# Rules\nNever buy a token with a tax above 10%. Café €\n";

async function textOf(store: WorkspaceFiles, place: WorkspacePlace) {
  const read = await store.read(place, signal());
  return read.ok ? read.value.text : undefined;
}

const readWriteChecks = (harness: WorkspaceFilesHarness): readonly ContractCheck[] => [
  {
    name: "reads back a file it wrote, byte for byte, with the time it changed",
    run: async () => {
      const store = await harness.create();
      const updatedAtMs = await store.write(at("RULES.md"), rules, signal());
      assert.deepEqual(await store.read(at("RULES.md"), signal()), {
        ok: true,
        value: { text: rules, updatedAtMs },
      });
    },
  },
  {
    name: "answers not_found for a file the agent does not have",
    run: async () => {
      const store = await harness.create();
      assert.deepEqual(await store.read(at("NOTES.md"), signal()), err("not_found"));
    },
  },
  {
    name: "replaces a file's text on a write",
    run: async () => {
      const store = await harness.create();
      await store.write(at("NOTES.md"), "first", signal());
      await store.write(at("NOTES.md"), "", signal());
      assert.equal(await textOf(store, at("NOTES.md")), "");
    },
  },
  {
    name: "keeps each agent's files apart",
    run: async () => {
      const store = await harness.create();
      await store.write(at("RULES.md"), "mine", signal());
      await store.write(at("RULES.md", other), "theirs", signal());
      assert.deepEqual(
        [await textOf(store, at("RULES.md")), await textOf(store, at("RULES.md", other))],
        ["mine", "theirs"],
      );
    },
  },
];

const createChecks = (harness: WorkspaceFilesHarness): readonly ContractCheck[] => [
  {
    name: "creates a file the agent does not have, and never replaces one it has",
    run: async () => {
      const store = await harness.create();
      const made = await store.create(at("FIRST-CHAT.md"), "questions", signal());
      assert.ok(made.ok);
      const again = await store.create(at("FIRST-CHAT.md"), "other", signal());
      assert.deepEqual(again, err("exists"));
      assert.equal(await textOf(store, at("FIRST-CHAT.md")), "questions");
    },
  },
];

const removeChecks = (harness: WorkspaceFilesHarness): readonly ContractCheck[] => [
  {
    name: "removes a file, which then reads as not_found and can be created again",
    run: async () => {
      const store = await harness.create();
      await store.write(at("FIRST-CHAT.md"), "questions", signal());
      await store.write(at("FIRST-CHAT.md", other), "theirs", signal());
      assert.deepEqual(await store.remove(at("FIRST-CHAT.md"), signal()), ok(undefined));
      assert.deepEqual(await store.read(at("FIRST-CHAT.md"), signal()), err("not_found"));
      assert.equal(await textOf(store, at("FIRST-CHAT.md", other)), "theirs");
      assert.ok((await store.create(at("FIRST-CHAT.md"), "again", signal())).ok);
    },
  },
  {
    name: "answers not_found when it removes a file the agent does not have",
    run: async () => {
      const store = await harness.create();
      assert.deepEqual(await store.remove(at("FIRST-CHAT.md"), signal()), err("not_found"));
    },
  },
];

const nameChecks = (harness: WorkspaceFilesHarness): readonly ContractCheck[] => [
  {
    name: "refuses a name outside the agent's folder before it touches a file",
    run: async () => {
      const store = await harness.create();
      await assert.rejects(store.read(at("../RULES.md"), signal()), invalid);
      await assert.rejects(store.write(at("RULES.md", ".."), "x", signal()), invalid);
      await assert.rejects(store.create(at("rules.md"), "x", signal()), invalid);
      await assert.rejects(store.remove(at("../FIRST-CHAT.md"), signal()), invalid);
    },
  },
  {
    name: "rejects with the signal's reason once it aborted",
    run: async () => {
      const store = await harness.create();
      const aborted = AbortSignal.abort(new Error("stopped"));
      await assert.rejects(store.read(at("RULES.md"), aborted), /stopped/u);
      await assert.rejects(store.write(at("RULES.md"), "x", aborted), /stopped/u);
      await assert.rejects(store.remove(at("RULES.md"), aborted), /stopped/u);
    },
  },
];

/**
 * The contract every {@link WorkspaceFiles} adapter keeps: files read back byte for byte with the
 * time they changed, a missing file is `not_found`, a write replaces, `create` never replaces, a
 * removed file is gone and a missing one is `not_found`, agents stay apart, and a name outside an
 * agent's folder throws before anything is touched.
 */
export function workspaceFilesContract(harness: WorkspaceFilesHarness): readonly ContractCheck[] {
  return [
    ...readWriteChecks(harness),
    ...createChecks(harness),
    ...removeChecks(harness),
    ...nameChecks(harness),
  ];
}
