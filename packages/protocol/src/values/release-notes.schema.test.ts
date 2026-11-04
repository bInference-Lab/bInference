import { describe, expect, it } from "vitest";
import { releaseNotesSchema } from "./release-notes.schema.js";

const refused: Readonly<Record<string, unknown>> = {
  "a sixth line": { en: Array.from({ length: 6 }, () => "x"), zh: [] },
  "a line of 201 characters": { en: ["x".repeat(201)], zh: [] },
  "an empty line": { en: [""], zh: [] },
  "a missing language": { en: ["x"] },
};

describe("releaseNotesSchema", () => {
  it("takes up to 5 lines of up to 200 characters in each language", () => {
    const lines = Array.from({ length: 5 }, () => "x".repeat(200));
    expect(releaseNotesSchema.safeParse({ en: lines, zh: [] }).success).toBe(true);
  });

  it.each(Object.keys(refused))("refuses %s", (name) => {
    expect(releaseNotesSchema.safeParse(refused[name]).success).toBe(false);
  });
});
