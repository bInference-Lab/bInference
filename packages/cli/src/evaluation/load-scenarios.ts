import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BinferenceError, type JsonValue, jsonValueSchema } from "@binference/core";
import { listFolderFiles, readTextFile } from "@binference/platform";
import { parse } from "yaml";
import { type EvaluationSkill, loadBundledSkills } from "./bundled-skills.js";
import {
  type Scenario,
  scenarioSchema,
  type ScenarioWorld,
  scenarioWorldSchema,
  type WorldBalance,
  type WorldToken,
} from "./scenario.schema.js";
import { objectOf } from "./world-answers.js";

/** The world every scenario starts from: its tokens, the agent's balances and bundled skills. */
export interface SharedWorld {
  readonly tokens: readonly WorldToken[];
  readonly balances: readonly WorldBalance[];
  readonly skills: readonly EvaluationSkill[];
}

/** The evaluation's scenarios in both languages, and the world they share. */
export interface ScenarioBook {
  readonly world: SharedWorld;
  readonly scenarios: readonly Scenario[];
}

/** The folder of the scenarios the evaluation ships: `world.yaml`, then `en/` and `zh/`. */
export const scenarioFolder: string = fileURLToPath(new URL("scenarios", import.meta.url));

const tokenRef = /^@([A-Z][A-Z0-9]*)$/;

function isList(value: JsonValue): value is readonly JsonValue[] {
  return Array.isArray(value);
}

function unreadable(file: string, message: string): BinferenceError {
  return new BinferenceError({
    code: "evaluation.bad_scenario",
    message: `${file}: ${message}`,
    details: { file },
  });
}

async function readYaml(file: string, signal: AbortSignal): Promise<JsonValue> {
  const read = await readTextFile(file, signal);
  if (!read.ok) {
    throw unreadable(file, "the file is missing.");
  }
  return jsonValueSchema.parse(parse(read.value));
}

// Every string that is exactly `@KEY` becomes the asset of the token with that key.
function withAssets(
  value: JsonValue,
  assets: ReadonlyMap<string, string>,
  file: string,
): JsonValue {
  if (typeof value === "string") {
    const key = tokenRef.exec(value)?.[1];
    const asset = key === undefined ? value : assets.get(key);
    if (asset === undefined) {
      throw unreadable(file, `no token has the key ${value}.`);
    }
    return asset;
  }
  if (isList(value)) {
    return value.map((item) => withAssets(item, assets, file));
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).map(([key, item]): [string, JsonValue] => [
      key,
      withAssets(item, assets, file),
    ]);
    return Object.fromEntries(entries);
  }
  return value;
}

function sharedWorldOf(
  world: ScenarioWorld,
  file: string,
  skills: readonly EvaluationSkill[],
): SharedWorld {
  if (world.tokens === undefined || world.balances === undefined) {
    throw unreadable(file, "the shared world names its tokens and balances.");
  }
  return { tokens: world.tokens, balances: world.balances, skills };
}

async function readScenario(
  file: string,
  world: SharedWorld,
  signal: AbortSignal,
): Promise<Scenario> {
  const raw = await readYaml(file, signal);
  const read = { ...objectOf(raw), locale: file.split(/[\\/]/).at(-2) ?? "" };
  const draft = scenarioSchema.safeParse(read);
  if (!draft.success) {
    throw unreadable(file, draft.error.message);
  }
  const tokens = [...world.tokens, ...(draft.data.world.tokens ?? [])];
  const assets = new Map(tokens.map((token) => [token.key, token.asset]));
  return scenarioSchema.parse(withAssets(read, assets, file));
}

/**
 * Reads the shared world and every scenario under `folder`, each language's from its own folder,
 * in file name order, and the bundled skills every agent's index holds. A string that is exactly
 * `@KEY` reads as the asset of the token with that key. A file that does not parse throws, naming
 * it.
 */
export async function loadScenarios(folder: string, signal: AbortSignal): Promise<ScenarioBook> {
  const worldFile = join(folder, "world.yaml");
  const world = sharedWorldOf(
    scenarioWorldSchema.parse(await readYaml(worldFile, signal)),
    worldFile,
    await loadBundledSkills(signal),
  );
  const files = (await listFolderFiles(folder, signal)).filter((file) =>
    /^(?:en|zh)[\\/][^\\/]+\.yaml$/.test(file),
  );
  const scenarios = await Promise.all(
    files.map(async (file) => readScenario(join(folder, file), world, signal)),
  );
  return { world, scenarios };
}
