import type { RepairStep } from "./repair-step.js";

/** A tool's name as a repair reads it: the declared tool, and the steps that found it. */
export interface NameRepair {
  readonly name: string;
  readonly steps: readonly RepairStep[];
}

// One prefix a model writes before a tool's name, in any case, joined by a dot, a slash or a colon.
const namePrefix = /^(?:functions?|tools?|default_api)[./:]/iu;

// ASCII letters in lowercase, every other character as it is, so no letter of another script
// folds into a tool's name.
function asciiLower(text: string): string {
  return text.replace(/[A-Z]/gu, (letter) => letter.toLowerCase());
}

/**
 * The declared tool a model's name stands for (runtime spec, section 5.6): the name without one
 * known prefix (`name_prefix`), then the one declared name it equals in another case
 * (`name_case`). Answers `undefined` for a name already declared, one that fits no tool, and one
 * that fits two.
 */
export function repairToolName(written: string, names: readonly string[]): NameRepair | undefined {
  if (names.includes(written)) {
    return undefined;
  }
  const bare = written.replace(namePrefix, "");
  const steps: readonly RepairStep[] = bare === written ? [] : ["name_prefix"];
  if (names.includes(bare)) {
    return { name: bare, steps };
  }
  const folded = asciiLower(bare);
  const fits = names.filter((name) => asciiLower(name) === folded);
  const [name] = fits;
  return fits.length === 1 && name !== undefined
    ? { name, steps: [...steps, "name_case"] }
    : undefined;
}
