import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { GateCase } from "./gate-case.mjs";

interface SourceEdit {
  readonly file: string;
  readonly from: string;
  readonly to: string;
}

const byeFile = "packages/protocol/src/frames/bye-frame.schema.ts";
const pushFile = "packages/protocol/src/frames/push-frame.schema.ts";
const versionFile = "packages/protocol/src/versions/protocol-version.ts";
const settingsFile = "packages/protocol/src/operations/settings-operations.schema.ts";
const message = "  message: z.string(),\n";

const removeMessage: SourceEdit = { file: byeFile, from: message, to: "" };
const addReason: SourceEdit = {
  file: byeFile,
  from: message,
  to: `${message}  reason: z.string().exactOptional(),\n`,
};
const seqAsText: SourceEdit = {
  file: pushFile,
  from: "  seq: z.int().positive(),\n",
  to: "  seq: z.string(),\n",
};
const raiseVersion: SourceEdit = {
  file: versionFile,
  from: "protocolVersion: number = 1;",
  to: "protocolVersion: number = 2;",
};

// The cases edit the real schemas. When a schema moves on, the edit throws here instead of
// planting nothing and letting the case pass.
function edited(repo: string, edits: readonly SourceEdit[]): Record<string, string> {
  const files: Record<string, string> = {};
  for (const item of edits) {
    const text = files[item.file] ?? readFileSync(join(repo, item.file), "utf8");
    if (!text.includes(item.from)) {
      throw new Error(`${item.file} no longer holds ${JSON.stringify(item.from)}.`);
    }
    files[item.file] = text.replace(item.from, item.to);
  }
  return files;
}

// `ledger/export` and `config/read` are rows the engine leaves unserved as not built;
// `ledger/list` is served.
const narrowUnbuilt: SourceEdit = {
  file: settingsFile,
  from: '    name: "ledger/export",\n    scope: "read",\n',
  to: '    name: "ledger/export",\n    scope: "admin",\n',
};
const narrowServed: SourceEdit = {
  file: settingsFile,
  from: '    name: "ledger/list",\n    scope: "read",\n',
  to: '    name: "ledger/list",\n    scope: "admin",\n',
};
const widenUnbuilt: SourceEdit = {
  file: settingsFile,
  from: '    name: "config/read",\n    scope: "admin",\n',
  to: '    name: "config/read",\n    scope: "read",\n',
};
const requireUnbuiltField: SourceEdit = {
  file: settingsFile,
  from: "    args: z.strictObject({ ...ledgerRange, mode: agentModeSchema.exactOptional() }),\n",
  to: "    args: z.strictObject({ ...ledgerRange, mode: agentModeSchema }),\n",
};

const compat = ["pnpm", "check:protocol-compat"];
const write = [...compat, "--write"];

// Inside a version, only additions pass, and a raised version starts a snapshot of its own.
function versionCases(repo: string): readonly GateCase[] {
  return [
    {
      name: "a field removed from a frame inside a version fails check:protocol-compat",
      files: edited(repo, [removeMessage]),
      steps: [
        { command: compat, expect: "fail", output: [/frame\/bye\.message: the field was removed/] },
        { command: write, expect: "fail", output: [/only additions are allowed/] },
      ],
    },
    {
      name: "a field whose type changes inside a version fails check:protocol-compat",
      files: edited(repo, [seqAsText]),
      steps: [
        {
          command: compat,
          expect: "fail",
          output: [/frame\/push\.seq: "type" changes from "integer" to "string"/],
        },
      ],
    },
    {
      name: "a new optional field passes check:protocol-compat once --write records it",
      files: edited(repo, [addReason]),
      steps: [
        { command: compat, expect: "fail", output: [/frame\/bye\.reason: a new optional field/] },
        { command: write, expect: "pass" },
        { command: compat, expect: "pass" },
      ],
    },
    {
      name: "a removal with a raised version passes check:protocol-compat once --write records it",
      files: edited(repo, [removeMessage, raiseVersion]),
      steps: [
        { command: compat, expect: "fail", output: [/v2 has no snapshot/] },
        { command: write, expect: "pass" },
        { command: compat, expect: "pass", output: [/v2 matches/] },
      ],
    },
  ];
}

// A narrower scope passes only on a row the engine leaves unserved as not built; a wider one, or
// any other change to such a row, fails with why.
function scopeCases(repo: string): readonly GateCase[] {
  return [
    {
      name: "a narrower scope on an unbuilt row passes check:protocol-compat once --write records it",
      files: edited(repo, [narrowUnbuilt]),
      steps: [
        {
          command: compat,
          expect: "fail",
          output: [/call\/ledger\/export: "scope" changes from "read" to "admin", which narrows/],
        },
        { command: write, expect: "pass" },
        { command: compat, expect: "pass" },
      ],
    },
    {
      name: "a narrower scope on a served row fails check:protocol-compat",
      files: edited(repo, [narrowServed]),
      steps: [
        {
          command: write,
          expect: "fail",
          output: [/call\/ledger\/list: only a row the engine leaves unserved as not built may/],
        },
      ],
    },
    {
      name: "a wider scope on an unbuilt row fails check:protocol-compat",
      files: edited(repo, [widenUnbuilt]),
      steps: [
        {
          command: write,
          expect: "fail",
          output: [/call\/config\/read: the change widens who may call it/],
        },
      ],
    },
    {
      name: "another change to an unbuilt row's shape fails check:protocol-compat",
      files: edited(repo, [narrowUnbuilt, requireUnbuiltField]),
      steps: [
        {
          command: write,
          expect: "fail",
          output: [/call\/ledger\/export: a row the engine leaves unserved as not built changes/],
        },
      ],
    },
  ];
}

/**
 * Cases for check:protocol-compat: inside a version, only additions pass, and a narrower scope on a
 * row the engine leaves unserved as not built.
 */
export function protocolCases(repo: string): readonly GateCase[] {
  return [...versionCases(repo), ...scopeCases(repo)];
}
