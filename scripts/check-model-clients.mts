import { readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { listRepoFiles } from "./repo-files.mjs";

// Model SDK clients are built only in the runtime's providers folder, where every option is set
// (ENGINEERING.md section 17): elsewhere a client would read its own environment variables, retry
// on its own and log to the console.
const providersFolder = "packages/runtime/src/providers/";
const sourceFile = /^(?:packages|plugins)\/[^/]+\/src\/.+\.[cm]?tsx?$/;
// The openai and Anthropic SDKs, and Anthropic's clients for other clouds (bedrock-sdk,
// vertex-sdk, foundry-sdk).
const sdkPackages = String.raw`(?:openai|@anthropic-ai\/[\w.-]+)(?:\/[^"'\x60]*)?`;

const rules: readonly { readonly pattern: RegExp; readonly message: string }[] = [
  {
    pattern:
      /\bnew\s+(?:OpenAI|AzureOpenAI|BedrockOpenAI|Anthropic(?:Bedrock(?:Mantle)?|Vertex|Foundry|Aws)?)\s*\(/,
    message: "builds a model SDK client",
  },
  {
    pattern: new RegExp(
      String.raw`(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)["'\x60]${sdkPackages}["'\x60]`,
    ),
    message: "imports a model SDK",
  },
];

interface Finding {
  readonly where: string;
  readonly message: string;
}

function fileFindings(root: string, file: string): readonly Finding[] {
  return readFileSync(join(root, file), "utf8")
    .split("\n")
    .flatMap((line, index) =>
      rules
        .filter((rule) => rule.pattern.test(line))
        .map((rule) => ({ where: `${file}:${String(index + 1)}`, message: rule.message })),
    );
}

const root = process.cwd();
const files = listRepoFiles(root).filter(
  (file) => sourceFile.test(file) && !file.startsWith(providersFolder),
);
const findings = files.flatMap((file) => fileFindings(root, file));
for (const finding of findings) {
  console.error(
    `${finding.where}: check:model-clients: ${finding.message}; model clients live only in ` +
      `${providersFolder}.`,
  );
}
if (findings.length === 0) {
  console.log(
    `check:model-clients: ${String(files.length)} source files outside ${providersFolder} build ` +
      "no model client.",
  );
}
process.exitCode = findings.length === 0 ? 0 : 1;
