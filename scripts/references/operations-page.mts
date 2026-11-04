import type { Formatter } from "@binference/i18n";
import { type Operation, operations, protocolVersion } from "@binference/protocol";
import { code, type ReferencePage, table } from "./reference-page.mjs";

function scopeText(operation: Operation, formatter: Formatter): string {
  const own = code(operation.scope);
  const other = operation.scopeCase;
  if (other === undefined) {
    return own;
  }
  const condition = formatter.message(`docs.operations.when.${other.when}`);
  const instead = formatter.message("docs.operations.scopeCase", {
    scope: code(other.scope),
    condition,
  });
  return `${own}; ${instead}`;
}

function rowOf(operation: Operation, formatter: Formatter): readonly string[] {
  return [
    code(operation.name),
    scopeText(operation, formatter),
    formatter.message(`docs.operations.kind.${operation.kind}`),
    formatter.message(`docs.operations.transport.${operation.transport}`),
    formatter.message(`docs.operations.responder.${operation.answeredBy}`),
  ];
}

// Operations grouped by their domain, the part of the name before its slash, in table order.
function domainsOf(all: readonly Operation[]): ReadonlyMap<string, readonly Operation[]> {
  const domains = new Map<string, Operation[]>();
  for (const operation of all) {
    const domain = operation.name.split("/")[0] ?? operation.name;
    domains.set(domain, [...(domains.get(domain) ?? []), operation]);
  }
  return domains;
}

function render(formatter: Formatter): string {
  const headers = ["operation", "scope", "kind", "accepted", "answeredBy"].map((key) =>
    formatter.message(`docs.operations.${key}`),
  );
  const domains = [...domainsOf(Object.values(operations))].map(([domain, items]) =>
    [
      `## ${code(domain)}`,
      "",
      table(
        headers,
        items.map((operation) => rowOf(operation, formatter)),
      ),
      "",
    ].join("\n"),
  );
  const intro = formatter.message("docs.operations.intro", { version: String(protocolVersion) });
  return [intro, "", ...domains].join("\n");
}

/** The reference of every engine protocol operation, from the protocol's operation tables. */
export const operationsPage: ReferencePage = { name: "operations", file: "operations", render };
