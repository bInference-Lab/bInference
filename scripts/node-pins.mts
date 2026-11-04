import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import { z } from "zod";
import { runCommand } from "./run-command.mjs";

// Writes the Node release the install scripts install, and the SHA-256 of each archive they may
// fetch, from Node's SHASUMS256.txt after gpgv checks its signature with the keyring of Node's
// release keys that config/node-release-keys.json pins by commit and SHA-256 (decision 0357). It
// reads the network and never runs in pnpm check:
//
//   pnpm node:pins                    re-reads the pinned release, fails on any difference and
//                                     names a newer Node 26 release
//   pnpm node:pins --version 26.14.0  pins that release in both scripts

const usage =
  "Usage: pnpm node:pins [--version <26.x.y>]. Without --version it checks the pins in " +
  "install/install.sh and install/install.ps1 against Node's signed checksums.";

const distribution = "https://nodejs.org/dist";

// The keyring of every key that ever signed a Node release, at one commit of the repository Node's
// README names, so a releaser who leaves the active list never turns an older pin's check red.
const keyringSchema = z.object({
  repository: z.string(),
  commit: z.string().regex(/^[0-9a-f]{40}$/),
  file: z.string(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});
const keyringFile = "config/node-release-keys.json";

// The archive each script fetches per platform: tar.gz for sh, which every tar unpacks, and zip
// for PowerShell's Expand-Archive.
const posixArchives = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"];
const windowsArchives = ["win-arm64", "win-x64"];

const root = process.cwd();
const posixScript = join(root, "install", "install.sh");
const windowsScript = join(root, "install", "install.ps1");
const marked = /(# node-pins:start\n)[\s\S]*?(\n[ \t]*# node-pins:end)/;

function fail(message: string): never {
  console.error(`node:pins: ${message}`);
  process.exit(1);
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) {
    return fail(`${url} answered ${String(response.status)}.`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

// The pinned keyring's bytes, refused when their SHA-256 is not the pin.
async function pinnedKeyring(): Promise<Uint8Array> {
  const pin = keyringSchema.parse(JSON.parse(readFileSync(join(root, keyringFile), "utf8")));
  const bytes = await fetchBytes(`${pin.repository}/raw/${pin.commit}/${pin.file}`);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return sha256 === pin.sha256
    ? bytes
    : fail(
        `the keyring at ${pin.commit} has SHA-256 ${sha256}, not the ${pin.sha256} ${keyringFile} pins.`,
      );
}

function checkGpgv(): void {
  const found = runCommand(["gpgv", "--version"], { cwd: root });
  if (found.status !== 0) {
    fail(
      "gpgv is not installed. Install GnuPG (brew install gnupg, or apt install gpgv), then run again.",
    );
  }
}

// SHASUMS256.txt, once gpgv accepts its detached signature with the pinned keyring.
async function signedSums(version: string): Promise<string> {
  checkGpgv();
  const folder = mkdtempSync(join(tmpdir(), "binference-node-pins-"));
  try {
    const base = `${distribution}/v${version}`;
    const files = {
      sums: join(folder, "SHASUMS256.txt"),
      signature: join(folder, "SHASUMS256.txt.sig"),
      keys: join(folder, "pubring.kbx"),
    };
    writeFileSync(files.sums, await fetchBytes(`${base}/SHASUMS256.txt`));
    writeFileSync(files.signature, await fetchBytes(`${base}/SHASUMS256.txt.sig`));
    writeFileSync(files.keys, await pinnedKeyring());
    const check = runCommand(
      ["gpgv", "--status-fd", "1", "--keyring", files.keys, files.signature, files.sums],
      { cwd: folder },
    );
    if (check.status !== 0 || !/\[GNUPG:\] VALIDSIG /.test(check.output)) {
      return fail(`gpgv did not accept the signature of Node ${version}'s sums:\n${check.output}`);
    }
    return readFileSync(files.sums, "utf8");
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

function hashesOf(sums: string, version: string): ReadonlyMap<string, string> {
  const wanted = [
    ...posixArchives.map((platform) => [platform, `node-v${version}-${platform}.tar.gz`]),
    ...windowsArchives.map((platform) => [platform, `node-v${version}-${platform}.zip`]),
  ];
  const lines = new Map(
    sums
      .trim()
      .split("\n")
      .map((line) => line.split(/\s+/))
      .map(([hash = "", file = ""]) => [file, hash]),
  );
  return new Map(
    wanted.map(([platform = "", file = ""]) => {
      const hash = lines.get(file);
      return hash !== undefined && /^[0-9a-f]{64}$/.test(hash)
        ? [platform, hash]
        : fail(`Node ${version}'s signed sums list no ${file}.`);
    }),
  );
}

function posixBlock(version: string, hashes: ReadonlyMap<string, string>): string {
  const cases = posixArchives.map((platform) => {
    return `    ${platform}) echo ${hashes.get(platform) ?? ""} ;;`;
  });
  return [
    `node_version=${version}`,
    "node_sha256() {",
    '  case "$1" in',
    ...cases,
    '    *) echo "" ;;',
    "  esac",
    "}",
  ].join("\n");
}

function windowsBlock(version: string, hashes: ReadonlyMap<string, string>): string {
  const rows = windowsArchives.map((platform) => {
    return `    '${platform}' = '${hashes.get(platform) ?? ""}'`;
  });
  return [`  $NodeVersion = '${version}'`, "  $NodeHashes = @{", ...rows, "  }"].join("\n");
}

function withBlock(
  file: string,
  block: string,
): { readonly before: string; readonly after: string } {
  const before = readFileSync(file, "utf8");
  if (!marked.test(before)) {
    return fail(`${file} has no node-pins:start and node-pins:end block.`);
  }
  return {
    before,
    after: before.replace(marked, (_, start: string, end: string) => start + block + end),
  };
}

const indexSchema = z.array(z.looseObject({ version: z.string() }));

// The newest Node 26 release nodejs.org lists, for the check to name when it is newer than the pin.
async function newestRelease(): Promise<string | undefined> {
  const index = indexSchema.parse(
    JSON.parse(new TextDecoder().decode(await fetchBytes(`${distribution}/index.json`))),
  );
  return index.map((item) => item.version.slice(1)).find((item) => /^26\.\d+\.\d+$/.test(item));
}

// A version as text that sorts as the version does.
function sortKey(version: string): string {
  return version
    .split(".")
    .map((part) => part.padStart(6, "0"))
    .join(".");
}

function isNewer(candidate: string, pinned: string): boolean {
  return sortKey(candidate) > sortKey(pinned);
}

function pinnedVersion(): string {
  const version = /^node_version=(\S+)$/m.exec(readFileSync(posixScript, "utf8"))?.[1];
  return version ?? fail(`${posixScript} pins no node_version.`);
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { version: { type: "string" } },
});
if (positionals.length > 0) {
  fail(usage);
}
const version = values.version ?? pinnedVersion();
if (!/^26\.\d+\.\d+$/.test(version)) {
  fail(`${version} is not a Node 26 release. ${usage}`);
}
const hashes = hashesOf(await signedSums(version), version);
const scripts = [
  { file: posixScript, ...withBlock(posixScript, posixBlock(version, hashes)) },
  { file: windowsScript, ...withBlock(windowsScript, windowsBlock(version, hashes)) },
];
const stale = scripts.filter((script) => script.before !== script.after);
if (values.version === undefined) {
  for (const script of stale) {
    console.error(`node:pins: ${script.file} differs from Node ${version}'s signed sums.`);
  }
  process.exitCode = stale.length === 0 ? 0 : 1;
  console.log(
    stale.length === 0
      ? `node:pins: both install scripts match Node ${version}'s signed sums.`
      : "node:pins: run pnpm node:pins --version <26.x.y> to pin a release again.",
  );
  const newest = await newestRelease();
  if (newest !== undefined && isNewer(newest, version)) {
    console.log(
      `node:pins: Node ${newest} is out; pin it with pnpm node:pins --version ${newest}.`,
    );
  }
} else {
  for (const script of stale) {
    writeFileSync(script.file, script.after);
  }
  console.log(`node:pins: both install scripts pin Node ${version} from its signed sums.`);
}
