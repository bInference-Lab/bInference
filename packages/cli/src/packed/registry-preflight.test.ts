import { describe, expect, it } from "vitest";
import {
  type PackageOnRegistry,
  readRegistryAnswer,
  registryPreflight,
} from "./registry-preflight.js";

// What `npm view <name> versions dist-tags --json --loglevel=silent` printed on 2026-11-22.
const recorded = {
  binference: `{
  "versions": [
    "0.0.0-stage",
    "0.1.0",
    "1.0.0"
  ],
  "dist-tags": {
    "latest": "1.0.0"
  }
}
`,
  client: `{
  "error": {
    "code": "E404",
    "summary": "Not Found - GET https://registry.npmjs.org/@binference%2fclient - Not found",
    "detail": "The requested resource '@binference/client@*' could not be found or you do not have permission to access it.\\n\\nNote that you can also install from a\\ntarball, folder, http url, or git url."
  }
}
`,
  unreachable: `{
  "error": {
    "code": "ECONNREFUSED",
    "summary": "FetchError: request to http://127.0.0.1:9/binference failed, reason: connect ECONNREFUSED 127.0.0.1:9",
    "detail": "If you are behind a proxy, please make sure that the 'proxy' config is set properly.  See: 'npm help config'"
  }
}
`,
};

const beta = "2026.11.0-beta.1";
const scoped = ["@binference/client", "@binference/plugin-sdk", "@binference/protocol"];

function firstRelease(binference: string): PackageOnRegistry[] {
  return [
    ...scoped.map((name) => ({ name, answer: readRegistryAnswer(1, recorded.client) })),
    { name: "binference", answer: readRegistryAnswer(0, binference) },
  ];
}

describe("reading npm's answer for a package", () => {
  it("reads the versions and dist-tags of a package npm holds", () => {
    expect(readRegistryAnswer(0, recorded.binference)).toEqual({
      kind: "published",
      versions: ["0.0.0-stage", "0.1.0", "1.0.0"],
      distTags: { latest: "1.0.0" },
    });
  });

  it("reads a lone version, which npm prints as a string", () => {
    expect(
      readRegistryAnswer(0, '{ "versions": "1.0.0", "dist-tags": { "latest": "1.0.0" } }'),
    ).toMatchObject({ kind: "published", versions: ["1.0.0"] });
  });

  it("reads a 404 as a package npm never held", () => {
    expect(readRegistryAnswer(1, recorded.client)).toEqual({ kind: "new" });
  });

  it("leaves a registry that did not answer unread, with npm's code", () => {
    expect(readRegistryAnswer(1, recorded.unreachable)).toEqual({
      kind: "unread",
      reason: "ECONNREFUSED",
    });
    expect(readRegistryAnswer(1, "\n")).toMatchObject({ kind: "unread" });
  });
});

describe("the registry preflight of a release", () => {
  it("names each package that needs the bootstrap token and prints binference's dist-tags", () => {
    const found = registryPreflight(
      { version: beta, tagged: false },
      firstRelease(recorded.binference),
    );
    expect(found.problems).toEqual([]);
    expect(found.warnings).toEqual([]);
    expect(found.lines).toEqual([
      ...scoped.map(
        (name) =>
          `${name}: not on npm yet; its first publish needs NPM_BOOTSTRAP_TOKEN in the release ` +
          "environment (decision 0451).",
      ),
      "binference: on npm, latest is 1.0.0; it publishes through trusted publishing.",
    ]);
  });

  it("refuses a version npm holds already, before the tag exists", () => {
    const held = recorded.binference.replace('"1.0.0"\n  ]', `"1.0.0",\n    "${beta}"\n  ]`);
    const found = registryPreflight({ version: beta, tagged: false }, firstRelease(held));
    expect(found.problems).toEqual([
      `binference@${beta} is on npm already, which never takes a version twice.`,
    ]);
  });

  it("lets a run from the tag go on past a version npm holds, which the npm job skips", () => {
    const held = recorded.binference.replace('"1.0.0"\n  ]', `"1.0.0",\n    "${beta}"\n  ]`);
    const found = registryPreflight({ version: beta, tagged: true }, firstRelease(held));
    expect(found.problems).toEqual([]);
    expect(found.lines).toContain(`binference@${beta}: on npm already; the npm job skips it.`);
  });

  it("refuses a version older than one npm holds, naming the newest", () => {
    const newer = recorded.binference.replace('"1.0.0"\n  ]', '"1.0.0",\n    "2026.11.0"\n  ]');
    const found = registryPreflight({ version: beta, tagged: true }, firstRelease(newer));
    expect(found.problems).toEqual([
      `binference@${beta} is not newer than 2026.11.0 on npm; pick a newer version.`,
    ]);
  });

  it("warns of a package npm did not answer for, and refuses nothing for it", () => {
    const found = registryPreflight({ version: beta, tagged: false }, [
      { name: "binference", answer: readRegistryAnswer(1, recorded.unreachable) },
    ]);
    expect(found).toEqual({
      lines: [],
      warnings: [
        "binference: npm could not be read (ECONNREFUSED); its version and first publish are " +
          "unchecked.",
      ],
      problems: [],
    });
  });
});
