import type { EditProblem } from "./edit-plan.js";
import { itemAt } from "./item-at.js";

// The most lines, characters per line and closest lines a hint reads and shows, and how alike a
// line must be to show.
const hintLines = 1_000;
const hintLineChars = 120;
const hintShown = 3;
const hintAlike = 0.45;

// How many single-character changes turn one text into the other.
function distance(left: string, right: string): number {
  let row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const next = [i];
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left.charAt(i - 1) === right.charAt(j - 1) ? 0 : 1;
      next.push(
        Math.min(itemAt(row, j, 0) + 1, itemAt(next, j - 1, 0) + 1, itemAt(row, j - 1, 0) + cost),
      );
    }
    row = next;
  }
  return itemAt(row, right.length, 0);
}

function alike(left: string, right: string): number {
  // At least 1, so two empty texts are wholly alike.
  return 1 - distance(left, right) / Math.max(left.length, right.length, 1);
}

/** One of the file's lines, its number and how alike the old text's first line it is. */
interface Hint {
  readonly line: string;
  readonly number: number;
  readonly score: number;
}

// The file's lines closest to the old text's first line that holds text, best first, each with
// its line number, how alike it is, and what tells them apart.
function closestLines(text: string, oldText: string): readonly string[] {
  const wanted = oldText.split("\n").find((line) => line.trim() !== "") ?? "";
  const target = wanted.trim().slice(0, hintLineChars);
  if (target === "") {
    return [];
  }
  return text
    .split(/\r?\n/u)
    .slice(0, hintLines)
    .map((line, index): Hint => ({
      line,
      number: index + 1,
      score: alike(target, line.trim().slice(0, hintLineChars)),
    }))
    .filter((each) => each.score >= hintAlike)
    .toSorted((a, b) => b.score - a.score)
    .slice(0, hintShown)
    .map(({ line, number, score }) => {
      const why = line.trim() === wanted.trim() ? ", the same but for the spaces before it" : "";
      return `line ${String(number)} (${String(Math.round(score * 100))}% alike${why}): ${line.slice(0, hintLineChars)}`;
    });
}

/**
 * What the agent reads of an edit that could not be placed (decision 0386): which edit, how often
 * its text stands or which edit it overlaps, and for text found nowhere the file's closest lines
 * with their numbers, so the next try copies the text exactly.
 */
export function editProblemText(
  problem: EditProblem,
  context: { readonly text: string; readonly oldTexts: readonly string[] },
): string {
  const label = (index: number): string =>
    context.oldTexts.length === 1 ? "The edit" : `edits[${String(index)}]`;
  if (problem.kind === "overlap") {
    return `${label(problem.index)} and edits[${String(problem.other)}] overlap. Merge them into one edit or change separate parts.`;
  }
  if (problem.kind === "many_matches") {
    return `${label(problem.index)}: its old text stands ${String(problem.count)} times in the file and must stand once. Add lines around it.`;
  }
  const closest = closestLines(context.text, itemAt(context.oldTexts, problem.index, ""));
  const hint = closest.length === 0 ? [] : ["Closest lines in the file:", ...closest];
  return [
    `${label(problem.index)}: its old text is not in the file. It must match exactly, every space and line break included.`,
    ...hint,
  ].join("\n");
}
