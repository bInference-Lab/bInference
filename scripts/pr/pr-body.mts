const requiredSections = ["Problem", "Impact", "Evidence"];

const heading = /^## (.+)$/;
const comment = /<!--[\s\S]*?-->/g;
const checkbox = /^- \[( |x|X)\] (.+)$/;

/** Splits a Markdown body into its "## " sections, keyed by heading text. */
export function readSections(body: string): ReadonlyMap<string, string> {
  const sections = new Map<string, string>();
  let current: string | undefined;
  for (const line of body.replaceAll("\r\n", "\n").split("\n")) {
    const title = heading.exec(line)?.[1]?.trim();
    if (title !== undefined) {
      current = title;
      sections.set(current, "");
    } else if (current !== undefined) {
      sections.set(current, `${sections.get(current) ?? ""}${line}\n`);
    }
  }
  return sections;
}

function hasContent(section: string | undefined): boolean {
  return section !== undefined && section.replace(comment, "").trim().length > 0;
}

/** Problems with the required sections: missing, or holding only the template's comments. */
export function sectionProblems(sections: ReadonlyMap<string, string>): string[] {
  return requiredSections
    .filter((name) => !hasContent(sections.get(name)))
    .map((name) => `The PR body needs a filled "## ${name}" section.`);
}

function checklist(section: string): ReadonlyMap<string, boolean> {
  const items = section
    .split("\n")
    .map((line) => checkbox.exec(line.trim()))
    .filter((match) => match !== null)
    .map((match): [string, boolean] => [match[2] ?? "", match[1] !== " "]);
  return new Map(items);
}

/** Problems when the money-path checklist of the template is missing or left unticked. */
export function moneyPathProblems(
  sections: ReadonlyMap<string, string>,
  template: ReadonlyMap<string, string>,
): string[] {
  const expected = [...checklist(template.get("Money path") ?? "").keys()];
  const ticked = checklist(sections.get("Money path") ?? "");
  const open = expected.filter((item) => ticked.get(item) !== true);
  return open.length === 0
    ? []
    : [`The change touches the money path; tick every "## Money path" line: ${open.join(" ")}`];
}

/** A problem when dependencies changed and the "## Dependencies" section is empty. */
export function dependencyProblems(sections: ReadonlyMap<string, string>): string[] {
  return hasContent(sections.get("Dependencies"))
    ? []
    : ['Dependencies changed; say in "## Dependencies" what each one does and why.'];
}
