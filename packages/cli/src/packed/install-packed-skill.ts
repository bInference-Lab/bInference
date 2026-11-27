import { join } from "node:path";
import type { Clock, Random } from "@binference/core";
import { type FilePermissions, readFilePieces, writePrivateFile } from "@binference/platform";
import { sha512Integrity } from "../skills/fetch-skill.js";
import { type InstallOutcome, installSkill } from "../skills/install-skill.js";
import { readSkillSource } from "../skills/skill-source.js";

/** A skill package as `npm pack` wrote it: its name, version and tarball. */
export interface PackedSkill {
  readonly name: string;
  readonly version: string;
  readonly tarball: string;
}

/** Where a check installs: a folder of its own, and the parts an install takes. */
export interface PackedSkillPlace {
  readonly work: string;
  readonly permissions: FilePermissions;
  readonly clock: Clock;
  readonly random: Random;
}

async function readBytes(path: string, signal: AbortSignal): Promise<Uint8Array> {
  const pieces: Uint8Array[] = [];
  for await (const piece of readFilePieces(path, { signal })) {
    pieces.push(piece);
  }
  return new Uint8Array(Buffer.concat(pieces));
}

/**
 * Installs one skill folder of a packed skill package (decision 0457) as `skill/add` would from
 * npm: the source `npm:<name>@<version>#<folder>` pinned by the tarball's own SHA-512, the
 * tarball standing in for the registry, into `skills/` of `place.work`, beside no bundled skill.
 * Answers the install's outcome: the skill in place, or why it changed nothing, such as a lint
 * finding.
 */
export async function installPackedSkill(
  { folder, ...packed }: PackedSkill & { readonly folder: "agent" | "mcp" },
  place: PackedSkillPlace,
  signal: AbortSignal,
): Promise<InstallOutcome> {
  const bytes = await readBytes(packed.tarball, signal);
  const hash = sha512Integrity(bytes);
  const source = `npm:${packed.name}@${packed.version}#${folder}`;
  const from = readSkillSource(source, hash);
  if (!from.ok) {
    return { ok: false, failure: { code: "skill.invalid" } };
  }
  const options = { permissions: place.permissions, signal };
  const pack = async (_spec: string, destination: string): Promise<boolean> => {
    await writePrivateFile(join(destination, "skill.tgz"), bytes, options);
    return true;
  };
  const parts = {
    folders: { installed: join(place.work, "skills"), staging: join(place.work, "skill-work") },
    shelf: { bundledNames: async () => Promise.resolve(new Set<string>()) },
    permissions: place.permissions,
    clock: place.clock,
    random: place.random,
    proxy: () => ({ noProxy: [] }),
    pack,
  };
  return installSkill(parts, { source, hash, from: from.value }, signal);
}
