import { readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

// The release workflow's npm job runs this before it publishes anything (decision 0354): only a
// stable or beta release a dry run wrote from its tag publishes, never a nightly pack. The job
// holds the publish token, so this runs on Node alone, with no install and no import beyond Node.
// The version rule is the release tag's (release/release-tag.mts) without its `v`.
const releaseVersion = /^20\d\d\.([1-9]|1[0-2])\.(0|[1-9]\d*)(-beta\.(0|[1-9]\d*))?$/;
const channels = new Set(["stable", "beta"]);

function refusal(folder: string): string | undefined {
  const parsed: unknown = JSON.parse(readFileSync(join(folder, "release.json"), "utf8"));
  const fields = new Map(
    typeof parsed === "object" && parsed !== null ? Object.entries(parsed) : [],
  );
  const read = (key: string): string => {
    const value: unknown = fields.get(key);
    return typeof value === "string" ? value : "";
  };
  const version = read("version");
  const channel = read("channel");
  if (!releaseVersion.test(version) || !channels.has(channel)) {
    return (
      `${version || "No version"} on the ${channel || "unnamed"} channel never publishes: ` +
      "only a stable or beta release that pnpm release:dry wrote from its tag does."
    );
  }
  return undefined;
}

const [folder] = process.argv.slice(2);
if (folder === undefined) {
  console.error("Usage: node scripts/release-publish-check.mts <folder>, a release:dry folder.");
  process.exit(1);
}
const problem = refusal(folder);
if (problem !== undefined) {
  console.error(`release-publish-check: ${problem}`);
  process.exit(1);
}
console.log(`release-publish-check: ${folder} holds a release that may publish.`);
