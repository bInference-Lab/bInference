import type { GateCase } from "./gate-case.mjs";

// The release dry run checks its tag, the tree and the version before it builds anything, so
// each refusal costs a second.
const newerTag = "v2099.1.0";

/** Cases for the release's own checks: the calver tag, a clean tree, a version that grows. */
export function releaseCases(): readonly GateCase[] {
  return [
    {
      name: "a tag outside calver fails release:dry",
      steps: [
        {
          command: ["pnpm", "release:dry", "v2026.13.0"],
          expect: "fail",
          output: [/not a release tag/],
        },
        {
          command: ["pnpm", "release:dry", "v2026.11.0-rc.1"],
          expect: "fail",
          output: [/not a release tag/],
        },
      ],
    },
    {
      name: "a working tree with changes fails release:dry",
      files: { "notes.md": "# Notes\n\nNot committed yet.\n" },
      steps: [
        {
          command: ["pnpm", "release:dry", "v2026.11.0"],
          expect: "fail",
          output: [/working tree has changes/],
        },
      ],
    },
    {
      name: "a version not newer than a release tag fails release:dry",
      steps: [
        { command: ["git", "tag", "--force", newerTag], expect: "pass" },
        {
          command: ["pnpm", "release:dry", "v2026.11.0-beta.1"],
          expect: "fail",
          output: [new RegExp(`not newer than ${newerTag.replaceAll(".", "\\.")}`)],
        },
        { command: ["git", "tag", "--delete", newerTag], expect: "pass" },
      ],
    },
  ];
}
