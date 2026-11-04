import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { configCatalogFile, configCatalogText } from "./config-catalog.mjs";
import { type ReferenceFile, referenceFolders, referencePages } from "./reference-files.mjs";
import { type MissingMessage, missingMessages } from "./required-messages.mjs";

/** The generated files as the code says them, and what on disk or in the catalogs differs. */
export interface ReferenceState {
  /** The English config key catalog, then every page once no message is missing. */
  readonly files: readonly ReferenceFile[];
  /** Generated files missing on disk or holding other text. */
  readonly behind: readonly ReferenceFile[];
  /** Files in a reference folder that no page generates. */
  readonly extra: readonly string[];
  /** Messages a page needs that a catalog lacks; the pages wait for them. */
  readonly missing: readonly MissingMessage[];
}

function onDisk(root: string): readonly string[] {
  return Object.values(referenceFolders).flatMap((folder) =>
    existsSync(join(root, folder))
      ? readdirSync(join(root, folder)).map((name) => `${folder}${name}`)
      : [],
  );
}

function isBehind(root: string, item: ReferenceFile): boolean {
  const path = join(root, item.file);
  return !existsSync(path) || readFileSync(path, "utf8") !== item.text;
}

/** Compares the generated files under `root` with what the code generates. */
export function referenceState(root: string): ReferenceState {
  const catalog: ReferenceFile = { file: configCatalogFile, text: configCatalogText() };
  const missing = missingMessages();
  const pages = missing.length === 0 ? referencePages() : [];
  const files = [catalog, ...pages];
  const generated = new Set(pages.map((item) => item.file));
  const extra = pages.length === 0 ? [] : onDisk(root).filter((file) => !generated.has(file));
  return { files, behind: files.filter((item) => isBehind(root, item)), extra, missing };
}
