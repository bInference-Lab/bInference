import { isJsonObject, type JsonObject } from "../json-value.schema.js";
import { type ConfigEdit, valueAt } from "./config-edit.js";
import type { ConfigMigration } from "./migrate-config.js";

// Every key that holds US dollars, by its path; `*` is each model of `models.prices`.
const dollarPaths: readonly (readonly string[])[] = [
  ["defaults", "limits", "perTradeUsd"],
  ["defaults", "limits", "rollingDayUsd"],
  ["defaults", "limits", "liquidityFloorUsd"],
  ["defaults", "copy", "perBuyUsd"],
  ["defaults", "copy", "perLeaderDayUsd"],
  ["defaults", "modelBudgetUsdPerDay"],
  ["models", "prices", "*", "inputPerMTokUsd"],
  ["models", "prices", "*", "outputPerMTokUsd"],
  ["models", "prices", "*", "cachedPerMTokUsd"],
];

// The paths a pattern names in the file: `*` once for each key the object there holds.
function pathsIn(file: JsonObject, pattern: readonly string[]): readonly (readonly string[])[] {
  const star = pattern.indexOf("*");
  if (star === -1) {
    return [pattern];
  }
  const parent = valueAt(file, pattern.slice(0, star));
  const keys = isJsonObject(parent) ? Object.keys(parent) : [];
  const before = pattern.slice(0, star);
  const after = pattern.slice(star + 1);
  return keys.map((key) => before.concat(key, after));
}

/**
 * Version 3 to 4: US dollars are decimal text, such as `"100"`, so no amount passes through a
 * JavaScript number. Each dollar key the file writes as a number becomes the same amount as text.
 */
export const usdAsText: ConfigMigration = {
  from: 3,
  summary: 'Writes every US dollar amount as decimal text, such as "100", instead of a number.',
  edits: (file) =>
    dollarPaths
      .flatMap((pattern) => pathsIn(file, pattern))
      .flatMap((path): readonly ConfigEdit[] => {
        const value = valueAt(file, path);
        return typeof value === "number" ? [{ kind: "set", path, value: String(value) }] : [];
      }),
};
