import {
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";

const root = process.cwd();
const source = join(root, ".agents", "skills");
const link = join(root, ".claude", "skills");

function pointsAtSource(): boolean {
  return resolve(join(root, ".claude"), readlinkSync(link)) === resolve(source);
}

// Claude Code reads skills from .claude/skills; the files live in .agents/skills. A junction
// needs no admin rights on Windows, and other systems ignore the type and make a symlink.
function linkSkills(): void {
  mkdirSync(join(root, ".claude"), { recursive: true });
  const stat = lstatSync(link, { throwIfNoEntry: false });
  if (stat !== undefined) {
    if (!stat.isSymbolicLink()) {
      throw new Error(".claude/skills is a real folder; move what it holds into .agents/skills.");
    }
    if (pointsAtSource()) {
      return;
    }
    rmSync(link);
  }
  symlinkSync(join("..", ".agents", "skills"), link, "junction");
}

function verifySkills(): readonly string[] {
  const names = readdirSync(source, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  for (const name of names) {
    readFileSync(join(link, name, "SKILL.md"), "utf8");
  }
  return names;
}

linkSkills();
const names = verifySkills();
console.log(`setup: .claude/skills links ${String(names.length)} skills: ${names.join(", ")}.`);
