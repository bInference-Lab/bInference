import { readFileSync } from "node:fs";
import { join, posix } from "node:path";

/** A port: an interface exported from a ports.ts file. */
export interface Port {
  readonly name: string;
  readonly file: string;
  readonly packageRoot: string;
}

/** A module that returns a port, or an interface that extends one. */
export interface Implementation {
  readonly port: Port;
  readonly file: string;
}

const sourceFile = /^(?:packages|plugins)\/[^/]+\/src\/.+\.ts$/;

// The package folder a source file belongs to, such as packages/core.
function packageRootOf(file: string): string {
  return file.split("/").slice(0, 2).join("/");
}

// Source files of every package, tests left out.
function sourceFiles(files: readonly string[]): readonly string[] {
  return files.filter((file) => sourceFile.test(file) && !file.endsWith(".test.ts"));
}

/** The name of a port's contract suite: Clock has clockContract. */
export function suiteName(port: string): string {
  return `${port.charAt(0).toLowerCase()}${port.slice(1)}Contract`;
}

/** Reads a repo file. */
export function readSource(root: string, file: string): string {
  return readFileSync(join(root, file), "utf8");
}

/** Every interface exported from a ports.ts file. */
export function findPorts(root: string, files: readonly string[]): readonly Port[] {
  return sourceFiles(files)
    .filter((file) => posix.basename(file) === "ports.ts")
    .flatMap((file) =>
      [...readSource(root, file).matchAll(/^export interface (\w+)/gm)].map((match) => ({
        name: match[1] ?? "",
        file,
        packageRoot: packageRootOf(file),
      })),
    );
}

/** The contract suites a package exports: functions named after a port, ending in Contract. */
export function findSuites(root: string, files: readonly string[]): ReadonlySet<string> {
  return new Set(
    sourceFiles(files).flatMap((file) =>
      [...readSource(root, file).matchAll(/^export function (\w+Contract)\(/gm)].map(
        (match) => `${packageRootOf(file)}#${match[1] ?? ""}`,
      ),
    ),
  );
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Names that stand for the port in this file: the port itself and interfaces that extend it.
function portAliases(text: string, port: string): readonly string[] {
  const extending = new RegExp(`interface (\\w+)(?:<[^>]*>)? extends [^{]*\\b${port}\\b`, "g");
  return [port, ...[...text.matchAll(extending)].map((match) => match[1] ?? "")];
}

function returnsAny(text: string, names: readonly string[]): boolean {
  const alternatives = names.map(escapeRegex).join("|");
  const returning = new RegExp(`\\)\\s*:\\s*(?:Promise<|Readonly<)?(?:${alternatives})\\b`);
  return returning.test(text);
}

// A module implements a port when it returns the port, or an interface that extends it, and it
// sees the port's name: in the port's own package, or through an import.
function implementsPort(text: string, file: string, port: Port): boolean {
  const isVisible =
    packageRootOf(file) === port.packageRoot ||
    new RegExp(`import[^;]*\\b${port.name}\\b[^;]*from`).test(text);
  return isVisible && returnsAny(text, portAliases(text, port.name));
}

/** Every module that implements a port; ports.ts files and contract suites left out. */
export function findImplementations(
  root: string,
  files: readonly string[],
  ports: readonly Port[],
): readonly Implementation[] {
  return sourceFiles(files)
    .filter((file) => posix.basename(file) !== "ports.ts" && !file.endsWith("-contract.ts"))
    .flatMap((file) => {
      const text = readSource(root, file);
      return ports
        .filter((port) => implementsPort(text, file, port))
        .map((port) => ({ port, file }));
    });
}
