import { describe, expect, it } from "vitest";
import { readSkillSource } from "./skill-source.js";

const commit = "0123456789abcdef0123456789abcdef01234567";
const integrity = `sha512-${"A".repeat(86)}==`;

describe("readSkillSource", () => {
  it("reads a git source at a full commit, with the skill's folder", () => {
    expect(
      readSkillSource("git:https://github.com/example/skills.git#skills/dip-buyer", commit),
    ).toStrictEqual({
      ok: true,
      value: {
        kind: "git",
        url: "https://github.com/example/skills.git",
        commit,
        folder: "skills/dip-buyer",
      },
    });
    expect(readSkillSource("git:ssh://git@example.com/skills.git", "f".repeat(64))).toMatchObject({
      ok: true,
    });
  });

  it("reads an npm source at an exact version with its integrity", () => {
    expect(readSkillSource("npm:@example/dca-skill@1.2.3-beta.1", integrity)).toStrictEqual({
      ok: true,
      value: { kind: "npm", spec: "@example/dca-skill@1.2.3-beta.1", integrity },
    });
  });

  it.each([
    ["a short commit", "git:https://example.com/s.git", commit.slice(0, 12)],
    ["a tag in place of a commit", "git:https://example.com/s.git", "v1.0.0"],
    ["a plain http URL", "git:http://example.com/s.git", commit],
    ["a transport that runs a command", "git:ext::sh -c touch% /tmp/x", commit],
    ["a URL that starts like an option", "git:--upload-pack=touch", commit],
    ["a folder that climbs out", "git:https://example.com/s.git#../x", commit],
    ["a version range", "npm:dca-skill@^1.2.0", integrity],
    ["a tag in place of a version", "npm:dca-skill@latest", integrity],
    ["a SHA-1 integrity", "npm:dca-skill@1.2.3", "sha1-abc"],
    ["a commit for an npm package", "npm:dca-skill@1.2.3", commit],
    ["a source of another kind", "https://example.com/skill.zip", commit],
  ])("refuses %s", (_name, source, hash) => {
    expect(readSkillSource(source, hash)).toStrictEqual({ ok: false, error: "bad_source" });
  });
});
