import type { GateCase } from "./gate-case.mjs";

// The release dry run checks its tag, the tree and the version before it builds anything, so
// each refusal costs a second.
const newerTag = "v2099.1.0";

// A packed package whose `exports` names a file its tarball lacks, as a build that never wrote
// `dist/orders.mjs` once left it, and the release.json a dry run would write beside it.
const packedFolder = ".gates/packed";
const lackingPackage = {
  name: "@binference/protocol",
  version: "2026.11.0",
  type: "module",
  exports: { ".": { default: "./dist/index.mjs" }, "./orders": { default: "./dist/orders.mjs" } },
};
const lackingRelease = {
  tag: "v2026.11.0",
  version: "2026.11.0",
  channel: "stable",
  npmTag: "latest",
  imageTags: ["2026.11.0", "latest"],
  packages: [
    {
      name: "@binference/protocol",
      file: "binference-protocol-2026.11.0.tgz",
      bytes: 0,
      sha256: "",
    },
  ],
  sbom: "binference-2026.11.0.cdx.json",
  notes: "notes.md",
};

// The smoke installs the packed file into an empty project and fails on the missing entry, by
// name, before it starts anything.
const lackingFileCase: GateCase = {
  name: "a packed package that lacks a file its exports name fails release:smoke",
  cost: 5,
  files: {
    [`${packedFolder}/release.json`]: `${JSON.stringify(lackingRelease, null, 2)}\n`,
    [`${packedFolder}/package/package.json`]: `${JSON.stringify(lackingPackage, null, 2)}\n`,
    [`${packedFolder}/package/dist/index.mjs`]: "export const protocolVersion = 1;\n",
  },
  steps: [
    {
      command: ["npm", "pack", "--loglevel=error", "--pack-destination", ".."],
      cwd: `${packedFolder}/package`,
      expect: "pass",
    },
    {
      command: ["pnpm", "release:smoke", packedFolder],
      expect: "fail",
      output: [
        /@binference\/protocol: exports\["\.\/orders"\]\["default"\] names \.\/dist\/orders\.mjs/,
      ],
    },
  ],
};

/**
 * Cases for the release's own checks: the calver tag, a clean tree, a version that grows, and a
 * packed package that names a file it lacks.
 */
export function releaseCases(): readonly GateCase[] {
  return [
    lackingFileCase,
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
