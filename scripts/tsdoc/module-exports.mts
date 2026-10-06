// Where an exported name's TSDoc must be found.
type ExportSource =
  | { readonly kind: "here"; readonly line: number }
  | {
      readonly kind: "module";
      readonly specifier: string;
      readonly name: string;
      readonly line: number;
    };

/** What one module exports, read from its top-level statements. */
export interface ModuleExports {
  readonly names: ReadonlyMap<string, ExportSource>;
  /** `export * from` statements, followed when a name is not found among the names. */
  readonly stars: readonly { readonly specifier: string; readonly line: number }[];
}

interface Statement {
  readonly text: string;
  readonly line: number;
}

const declaration =
  /^export\s+(?:declare\s+)?(?:async\s+)?(?:abstract\s+)?(?:function\*?|const|let|var|class|interface|type|enum|namespace)\s+([A-Za-z_$][\w$]*)/;
const defaultExport = /^export\s+default\b/;
const starAs = /^export\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+["']([^"']+)["']/;
const star = /^export\s+\*\s+from\s+["']([^"']+)["']/;
const list = /^export\s+(?:type\s+)?\{([^}]*)\}\s*(?:from\s+["']([^"']+)["'])?/;
const importList = /^import\s+(?:type\s+)?\{([^}]*)\}\s*from\s+["']([^"']+)["']/;

// Lists and imports can span lines until their semicolon; a declaration counts by its first line.
function statementsOf(lines: readonly string[]): Statement[] {
  const statements: Statement[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const first = lines[index] ?? "";
    if (!/^(?:export|import)\s/.test(first) || declaration.test(first)) {
      statements.push({ text: first, line: index });
      continue;
    }
    let text = first;
    const start = index;
    while (!text.trimEnd().endsWith(";") && index + 1 < lines.length) {
      index += 1;
      text += ` ${(lines[index] ?? "").trim()}`;
    }
    statements.push({ text, line: start });
  }
  return statements;
}

/** Splits `a, type b as c` into [local, exported] pairs. */
function listItems(body: string): readonly [string, string][] {
  return body
    .split(",")
    .map((item) => item.trim().replace(/^type\s+/, ""))
    .filter((item) => item.length > 0)
    .map((item) => {
      const [local = "", exported = local] = item.split(/\s+as\s+/);
      return [local, exported];
    });
}

function localDeclaration(lines: readonly string[], name: string): number {
  const pattern = new RegExp(
    `^(?:export\\s+)?(?:declare\\s+)?(?:async\\s+)?(?:function\\*?|const|let|var|class|interface|type|enum)\\s+${name}\\b`,
  );
  return lines.findIndex((line) => pattern.test(line));
}

function importedFrom(statements: readonly Statement[], name: string): ExportSource | undefined {
  for (const statement of statements) {
    const match = importList.exec(statement.text);
    const item = listItems(match?.[1] ?? "").find(([, local]) => local === name);
    if (match !== null && item !== undefined) {
      return { kind: "module", specifier: match[2] ?? "", name: item[0], line: statement.line };
    }
  }
  return undefined;
}

interface ScanContext {
  readonly lines: readonly string[];
  readonly statements: readonly Statement[];
  readonly names: Map<string, ExportSource>;
}

function addList(context: ScanContext, statement: Statement, match: RegExpExecArray): void {
  const specifier = match[2];
  for (const [local, exported] of listItems(match[1] ?? "")) {
    if (specifier !== undefined) {
      context.names.set(exported, { kind: "module", specifier, name: local, line: statement.line });
      continue;
    }
    const line = localDeclaration(context.lines, local);
    const source: ExportSource | undefined =
      line === -1 ? importedFrom(context.statements, local) : { kind: "here", line };
    context.names.set(exported, source ?? { kind: "here", line: statement.line });
  }
}

/** Reads the exports of one module's source text. */
export function scanExports(text: string): ModuleExports {
  const lines = text.split("\n");
  const statements = statementsOf(lines);
  const names = new Map<string, ExportSource>();
  const stars: { specifier: string; line: number }[] = [];
  const context = { lines, statements, names };
  for (const statement of statements) {
    const listMatch = list.exec(statement.text);
    const starAsMatch = starAs.exec(statement.text);
    const name = declaration.exec(statement.text)?.[1] ?? starAsMatch?.[1];
    if (name !== undefined) {
      names.set(name, { kind: "here", line: statement.line });
    } else if (defaultExport.test(statement.text)) {
      names.set("default", { kind: "here", line: statement.line });
    } else if (listMatch !== null) {
      addList(context, statement, listMatch);
    } else {
      const starMatch = star.exec(statement.text);
      stars.push(
        ...(starMatch === null ? [] : [{ specifier: starMatch[1] ?? "", line: statement.line }]),
      );
    }
  }
  return { names, stars };
}
