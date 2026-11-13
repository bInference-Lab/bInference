/** A license or notice file: its name and its text. */
export interface NamedText {
  readonly file: string;
  readonly text: string;
}

/** An outside package a tarball carries a copy of inside its files, as its folder shows it. */
export interface BundledPackage {
  readonly name: string;
  readonly version: string;
  /** Its `package.json` `license`, an SPDX id or expression; `undefined` when it names none. */
  readonly license: string | undefined;
  /** Its license files, or the text the repository keeps for a package that ships none. */
  readonly licenseFiles: readonly NamedText[];
  /** Its NOTICE files, which Apache-2.0 asks every copy to carry. */
  readonly noticeFiles: readonly NamedText[];
}

/** The file each tarball that carries outside code holds at its root. */
export const bundledLicensesFile = "BUNDLED-LICENSES.md";

/** The one list of licenses a bundled package may carry, an SPDX id per line. */
export const allowedLicensesPath = "config/release/allowed-licenses.txt";

/** Where the repository keeps the license, from its own repository, of a package that ships none. */
export const keptLicensesFolder = "config/release/licenses";

/** The kept license file of one package version: `<name>@<version>.txt`, a scope's `/` as `+`. */
export function keptLicenseFile(name: string, version: string): string {
  return `${name.replace("/", "+")}@${version}.txt`;
}

/** Whether a file of a package's folder is a license file, a notice file, or neither. */
export function licenseFileKind(file: string): "license" | "notice" | undefined {
  if (/^(?:licen[cs]e|copying)/i.test(file)) {
    return "license";
  }
  return /^notice/i.test(file) ? "notice" : undefined;
}

/** The SPDX ids of the allowed list's text: one per line, `#` lines and blank lines skipped. */
export function parseAllowedLicenses(text: string): ReadonlySet<string> {
  const lines = text.split("\n").map((line) => line.trim());
  return new Set(lines.filter((line) => line !== "" && !line.startsWith("#")));
}

const spdxId = /^[A-Za-z0-9.+-]+$/;

/**
 * Whether an SPDX expression is allowed: one id, or ids joined by `OR` (one allowed is enough)
 * or by `AND` (each must be), in at most one pair of parentheses. Anything else, such as `WITH`,
 * nested parentheses or `SEE LICENSE IN`, is refused, since the check cannot read it.
 */
export function licenseAllowed(expression: string, allowed: ReadonlySet<string>): boolean {
  const inner = expression.trim().replace(/^\((.*)\)$/s, "$1");
  const either = inner.split(" OR ").map((id) => id.trim());
  const both = inner.split(" AND ").map((id) => id.trim());
  if (either.length > 1 && both.length > 1) {
    return false;
  }
  const ids = either.length > 1 ? either : both;
  if (!ids.every((id) => spdxId.test(id))) {
    return false;
  }
  return either.length > 1 ? ids.some((id) => allowed.has(id)) : ids.every((id) => allowed.has(id));
}

function keyOf(bundled: BundledPackage): string {
  return `${bundled.name}@${bundled.version}`;
}

// Each package once by its name and version, sorted by name and then version.
function uniquePackages(packages: readonly BundledPackage[]): readonly BundledPackage[] {
  const byKey = new Map(packages.toReversed().map((bundled) => [keyOf(bundled), bundled]));
  return [...byKey.values()].toSorted(
    (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
  );
}

function problemsOf(tarball: string, bundled: BundledPackage, allowed: ReadonlySet<string>) {
  const named = `${tarball} carries ${keyOf(bundled)}`;
  const { license } = bundled;
  return [
    ...(license === undefined ? [`${named}, whose package.json names no license.`] : []),
    ...(license !== undefined && !licenseAllowed(license, allowed)
      ? [`${named} under ${license}, which ${allowedLicensesPath} does not allow.`]
      : []),
    ...(bundled.licenseFiles.length === 0
      ? [
          `${named}, which ships no license file; keep the license from its repository as ` +
            `${keptLicensesFolder}/${keptLicenseFile(bundled.name, bundled.version)}.`,
        ]
      : []),
  ];
}

/**
 * Why a tarball may not carry its bundled packages, one line each naming the tarball and the
 * package: a package that names no license, one whose license the allowed list does not allow,
 * and one with no license text to ship.
 */
export function licenseProblems(
  tarball: string,
  packages: readonly BundledPackage[],
  allowed: ReadonlySet<string>,
): readonly string[] {
  return uniquePackages(packages).flatMap((bundled) => problemsOf(tarball, bundled, allowed));
}

// A fence longer than any run of backticks in the text, so no license text ends it early.
function fenced(text: string): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map(([run]) => run.length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}text\n${text.trimEnd()}\n${fence}`;
}

function sectionOf(bundled: BundledPackage): string {
  const texts = [...bundled.licenseFiles, ...bundled.noticeFiles].map(
    ({ file, text }) => `### ${file}\n\n${fenced(text)}`,
  );
  return [`## ${bundled.name} ${bundled.version}`, `License: ${bundled.license ?? ""}`, ...texts]
    .join("\n\n")
    .concat("\n");
}

/**
 * The text of a tarball's `BUNDLED-LICENSES.md`: each outside package it carries a copy of once,
 * with its license and notice files in full.
 */
export function bundledLicensesText(tarball: string, packages: readonly BundledPackage[]): string {
  const intro =
    `# Bundled licenses\n\n\`${tarball}\` carries copies of the outside packages below inside ` +
    "its own files. Their licenses and notices follow in full, one section per package. The " +
    "outside packages npm installs beside it carry their own.\n";
  return [intro, ...uniquePackages(packages).map(sectionOf)].join("\n");
}
