// oxlint-disable-next-line eslint/no-restricted-imports -- tests write their plugins' folders
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CommunityManifest, CommunityToolDeclaration } from "@binference/plugin-sdk/community";
import type { PluginFolders } from "../process/plugin-node-arguments.js";

/** A test plugin written to disk: its manifest and folders. */
export interface FixturePlugin {
  readonly manifest: CommunityManifest;
  readonly folders: PluginFolders;
}

// Each tool's body, as the plugin's entry module writes it.
const bodies: Readonly<Record<string, string>> = {
  echo: "async (input) => input",
  fetch_declared: `async (_input, context) => {
    const answer = await context.fetch({ url: "https://api.example.com/index" });
    return { status: answer.status, body: answer.body };
  }`,
  fetch_other: `async (_input, context) => {
    try {
      await context.fetch({ url: "https://other.example.net/" });
      return { refused: "no" };
    } catch (error) {
      return { refused: error.code };
    }
  }`,
  bad_output: "async () => ({ nope: true })",
  garble: 'async () => { process.stdout.write("not a message\\n"); return {}; }',
  crash: "async () => process.exit(7)",
  hang: "async () => new Promise(() => {})",
  where: "async (_input, context) => ({ cwd: process.cwd(), dataFolder: context.dataFolder })",
  outlive: `async () => {
    try {
      process.exit = () => undefined;
      return { exit: "replaced" };
    } catch (error) {
      return { exit: error.name };
    }
  }`,
  hog: `async () => {
    globalThis.held = Array.from({ length: 5 }, () => Buffer.alloc(64 * 1024 * 1024, 1));
    return {};
  }`,
  stall: `async (_input, context) => {
    for (let at = 0; at < 8; at += 1) {
      context.fetch({ url: "https://api.example.com/big" }).catch(() => undefined);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
    for (;;) {}
  }`,
};

const anyObject = { type: "object" } as const;
const noInput = { type: "object", properties: {}, additionalProperties: false } as const;

function declared(name: string): CommunityToolDeclaration {
  const echoInput = {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
    additionalProperties: false,
  };
  const output =
    name === "bad_output"
      ? { type: "object", properties: { value: { type: "integer" } }, required: ["value"] }
      : anyObject;
  return {
    name,
    description: `The ${name} tool.`,
    input: name === "echo" ? echoInput : noInput,
    output,
  };
}

/**
 * Writes a test plugin under `root`: a package folder whose `index.mjs` exports the named tools
 * of the fixture set (`echo`, `fetch_declared`, `fetch_other`, `bad_output`, `garble`, `crash`,
 * `hang`, `where`, `outlive`, `hog`, `stall`),
 * an empty data folder, and a manifest that declares `declares` (the same tools when absent) and
 * the host `api.example.com`.
 */
export async function writeFixturePlugin(
  root: string,
  plugin: {
    readonly id: string;
    readonly tools: readonly string[];
    readonly declares?: readonly string[];
    /** The entry module never finishes loading, so the plugin never answers `ready`. */
    readonly neverReady?: boolean;
  },
): Promise<FixturePlugin> {
  const packageFolder = join(root, plugin.id, "package");
  const dataFolder = join(root, plugin.id, "data");
  await mkdir(packageFolder, { recursive: true });
  await mkdir(dataFolder, { recursive: true });
  const lines = plugin.tools.map((name) => `  ${name}: ${bodies[name] ?? "async () => null"},`);
  await writeFile(
    join(packageFolder, "index.mjs"),
    `${plugin.neverReady === true ? "await new Promise(() => {});\n" : ""}export const tools = {\n${lines.join("\n")}\n};\n`,
  );
  const manifest: CommunityManifest = {
    api: 1,
    id: plugin.id,
    kinds: ["data"],
    entry: "index.mjs",
    hosts: ["api.example.com"],
    tools: (plugin.declares ?? plugin.tools).map(declared),
  };
  return { manifest, folders: { packageFolder, dataFolder } };
}
