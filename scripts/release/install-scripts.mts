import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** An install script staged for hosting: its file name and SHA-256. */
export interface StagedInstallScript {
  readonly file: string;
  readonly sha256: string;
}

/**
 * The content type binference.io serves the install scripts with: Windows PowerShell 5.1 reads a
 * response without a charset as ISO-8859-1, which garbles the Chinese lines (decision 0357).
 */
export const installScriptType = "text/plain; charset=utf-8";

// The install scripts a release hosts on binference.io, from the repository's `install/`.
const installScripts: readonly string[] = ["install.sh", "install.ps1"];

/**
 * Copies the install scripts into `out` byte for byte, each with a `<file>.sha256` beside it in
 * the form `sha256sum --check` reads, for the owner to host. Throws when a script is missing.
 */
export function stageInstallScripts(root: string, out: string): readonly StagedInstallScript[] {
  return installScripts.map((file) => {
    const bytes = readFileSync(join(root, "install", file));
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    writeFileSync(join(out, file), bytes);
    writeFileSync(join(out, `${file}.sha256`), `${sha256}  ${file}\n`);
    return { file, sha256 };
  });
}
