import { describe, expect, it } from "vitest";
import {
  type BundledPackage,
  bundledLicensesText,
  licenseAllowed,
  licenseFileKind,
  licenseProblems,
  parseAllowedLicenses,
} from "./bundled-licenses.js";

const allowed = parseAllowedLicenses(
  "# Permissive licenses only.\nMIT\n\nApache-2.0\n  ISC  \n# BSD-3-Clause\n",
);

function bundled(change: Partial<BundledPackage> = {}): BundledPackage {
  return {
    name: "openai",
    version: "7.28.0",
    license: "Apache-2.0",
    licenseFiles: [{ file: "LICENSE", text: "Apache License\nVersion 2.0\n" }],
    noticeFiles: [],
    ...change,
  };
}

describe("the licenses of a tarball's bundled packages", () => {
  it("reads the allowed list without its comments and blank lines", () => {
    expect([...allowed]).toEqual(["MIT", "Apache-2.0", "ISC"]);
  });

  it("tells license and notice files from the rest of a package's folder", () => {
    const kinds = ["LICENSE", "license", "LICENSE.md", "LICENCE-MIT", "COPYING", "NOTICE.txt"].map(
      licenseFileKind,
    );
    expect(kinds).toEqual(["license", "license", "license", "license", "license", "notice"]);
    expect(licenseFileKind("README.md")).toBeUndefined();
    expect(licenseFileKind("package.json")).toBeUndefined();
  });

  it("allows an id on the list, an OR with one on it, and an AND with each on it", () => {
    expect(licenseAllowed("MIT", allowed)).toBe(true);
    expect(licenseAllowed("(MIT OR Apache-2.0)", allowed)).toBe(true);
    expect(licenseAllowed("GPL-3.0-only OR MIT", allowed)).toBe(true);
    expect(licenseAllowed("MIT AND ISC", allowed)).toBe(true);
  });

  it.each([
    "GPL-3.0-only",
    "LGPL-2.1-or-later",
    "MPL-2.0",
    "MIT AND GPL-2.0-only",
    "Apache-2.0 WITH LLVM-exception",
    "(MIT OR ISC) AND Apache-2.0",
    "SEE LICENSE IN LICENSE.txt",
    "mit",
  ])("refuses %s: a copyleft license, an AND with one, or what it cannot read", (expression) => {
    expect(licenseAllowed(expression, allowed)).toBe(false);
  });

  it("passes a package under an allowed license that ships its text", () => {
    expect(licenseProblems("binference", [bundled()], allowed)).toEqual([]);
  });

  it("names the tarball and the package for each problem", () => {
    const packages = [
      bundled({ name: "standardwebhooks", version: "1.0.0", license: "MIT", licenseFiles: [] }),
      bundled({ name: "@scope/copyleft", version: "2.1.0", license: "GPL-3.0-only" }),
      bundled({ name: "@scope/bare", version: "3.0.0", license: "MIT", licenseFiles: [] }),
      bundled({ name: "nameless", version: "0.1.0", license: undefined }),
    ];
    expect(licenseProblems("binference", packages, allowed)).toEqual([
      "binference carries @scope/bare@3.0.0, which ships no license file; keep the license from " +
        "its repository as config/release/licenses/@scope+bare@3.0.0.txt.",
      "binference carries @scope/copyleft@2.1.0 under GPL-3.0-only, which " +
        "config/release/allowed-licenses.txt does not allow.",
      "binference carries nameless@0.1.0, whose package.json names no license.",
      "binference carries standardwebhooks@1.0.0, which ships no license file; keep the license " +
        "from its repository as config/release/licenses/standardwebhooks@1.0.0.txt.",
    ]);
  });

  it("counts a package bundled twice once", () => {
    const twice = [bundled({ license: "GPL-3.0-only" }), bundled({ license: "GPL-3.0-only" })];
    expect(licenseProblems("binference", twice, allowed)).toHaveLength(1);
  });

  it("writes each package once with its licenses and notices in full", () => {
    const sdk = bundled({
      name: "@anthropic-ai/sdk",
      version: "0.131.0",
      license: "MIT",
      licenseFiles: [{ file: "LICENSE", text: "Copyright 2023 Anthropic, PBC.\n" }],
      noticeFiles: [{ file: "NOTICE", text: "A notice with ``` inside.\n" }],
    });
    expect(bundledLicensesText("binference", [bundled(), sdk, bundled()])).toBe(
      [
        "# Bundled licenses",
        "",
        "`binference` carries copies of the outside packages below inside its own files. Their " +
          "licenses and notices follow in full, one section per package. The outside packages " +
          "npm installs beside it carry their own.",
        "",
        "## @anthropic-ai/sdk 0.131.0",
        "",
        "License: MIT",
        "",
        "### LICENSE",
        "",
        "```text",
        "Copyright 2023 Anthropic, PBC.",
        "```",
        "",
        "### NOTICE",
        "",
        "````text",
        "A notice with ``` inside.",
        "````",
        "",
        "## openai 7.28.0",
        "",
        "License: Apache-2.0",
        "",
        "### LICENSE",
        "",
        "```text",
        "Apache License",
        "Version 2.0",
        "```",
        "",
      ].join("\n"),
    );
  });
});
