// oxlint-disable-next-line eslint/no-restricted-imports -- reads this package's own source, as the build bundles it; nothing ships it
import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = dirname(dirname(fileURLToPath(import.meta.url)));

// The files of this package one file reaches through its relative imports, as the build bundles
// them from its entries.
function reachedFrom(entries: readonly string[]): ReadonlySet<string> {
  const reached = new Set<string>();
  const due = [...entries];
  for (let file = due.pop(); file !== undefined; file = due.pop()) {
    if (reached.has(file)) {
      continue;
    }
    reached.add(file);
    const text = readFileSync(join(source, file), "utf8");
    for (const [, specifier] of text.matchAll(/(?:from|import)\s*\(?\s*"(\.{1,2}\/[^"]+)\.js"/gu)) {
      due.push(relative(source, join(source, dirname(file), `${specifier ?? ""}.ts`)));
    }
  }
  return reached;
}

describe("the shipped build", () => {
  const shipped = reachedFrom(["main.ts", "index.ts"]);

  it("bundles none of the crash suite's engine, its test orders or its test signer", () => {
    expect(shipped.has("main.ts")).toBe(true);
    expect(shipped.has("compose/order-pricing.ts")).toBe(true);
    expect([...shipped].filter((file) => file.startsWith("crash/"))).toStrictEqual([]);
    expect(shipped.has("e2e/test-signer.ts")).toBe(false);
  });

  it("gives no host test orders, so its engine never fills a live order", () => {
    const setters = [...shipped].filter((file) =>
      /\btestOrders\s*:/u.test(readFileSync(join(source, file), "utf8")),
    );

    expect(setters).toStrictEqual([]);
  });
});
