import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The lists check:style reads from config/style. */
export interface WordLists {
  /** Filler and hype words, banned in every text. */
  readonly banned: ReadonlySet<string>;
  /** Vague words, banned in commit messages and PR titles. */
  readonly vague: ReadonlySet<string>;
  /** Names of AI tools that an attribution trailer may name. */
  readonly aiTools: readonly string[];
  /** SHA-256 hashes of reserved names. */
  readonly reserved: ReadonlySet<string>;
  /** Per file, the reserved-name hashes it may use. */
  readonly exceptions: ReadonlyMap<string, ReadonlySet<string>>;
}

/** The folder that holds the lists; check:style never scans it. */
export const styleFolder = "config/style";

function readList(repo: string, name: string): readonly string[] {
  return readFileSync(join(repo, styleFolder, name), "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

function readExceptions(repo: string): ReadonlyMap<string, ReadonlySet<string>> {
  const exceptions = new Map<string, Set<string>>();
  for (const line of readList(repo, "reserved-exceptions.txt")) {
    const [file = "", hash = ""] = line.split(/\s+/);
    const hashes = exceptions.get(file) ?? new Set<string>();
    hashes.add(hash);
    exceptions.set(file, hashes);
  }
  return exceptions;
}

/** Reads every list check:style needs. */
export function loadWordLists(repo: string): WordLists {
  return {
    banned: new Set(readList(repo, "banned-words.txt").map((word) => word.toLowerCase())),
    vague: new Set(readList(repo, "vague-words.txt").map((word) => word.toLowerCase())),
    aiTools: readList(repo, "ai-tools.txt").map((word) => word.toLowerCase()),
    reserved: new Set(readList(repo, "reserved.sha256")),
    exceptions: readExceptions(repo),
  };
}
