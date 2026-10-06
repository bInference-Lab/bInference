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

const compat = ["pnpm", "check:protocol-compat"];
const write = [...compat, "--write"];

/** Cases for check:protocol-compat: inside a version, only additions pass. */
export function protocolCases(repo: string): readonly GateCase[] {
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
