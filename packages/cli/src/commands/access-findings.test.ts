import { join } from "node:path";
import {
  type FileAccess,
  type FileAccessState,
  type FilePermissions,
  resolveStateFolder,
} from "@binference/platform";
import { describe, expect, it } from "vitest";
import { accessFindings } from "./access-findings.js";

const stateFolder = resolveStateFolder({ binferenceHome: join("/", "home", "owner", "state") });
const { root, configFile, keys } = stateFolder;
const token = join(root, "auth", "cli.token");

// A platform whose paths stand as given, missing when not listed, and that records each
// restriction and makes the path owner-only, or leaves it unknown as Windows does.
function platformWith(states: ReadonlyMap<string, FileAccessState>) {
  const current = new Map(states);
  const restricted: string[] = [];
  // A folder is recorded with a trailing slash, to tell the two restrictions apart.
  const restrict = async (path: string, recorded: string): Promise<void> => {
    restricted.push(recorded);
    current.set(path, current.get(path) === "unknown" ? "unknown" : "owner_only");
    return Promise.resolve();
  };
  const access: FileAccess = {
    read: async (path) => Promise.resolve(current.get(path) ?? "missing"),
  };
  const permissions: FilePermissions = {
    restrictFolder: async (path) => restrict(path, `${path}/`),
    restrictFile: async (path) => restrict(path, path),
  };
  return { platform: { stateFolder, access, permissions }, restricted };
}

const live = (): AbortSignal => new AbortController().signal;

describe("the access findings of binference check", () => {
  it("finds each path others can open, and leaves out what is not there", async () => {
    const { platform, restricted } = platformWith(
      new Map([
        [root, "owner_only"],
        [configFile, "open"],
        [token, "owner_only"],
      ]),
    );
    const findings = await accessFindings({ platform, fix: false, signal: live() });
    expect(findings).toStrictEqual([
      {
        check: "permissions.state_folder",
        level: "ok",
        details: { path: root, access: "owner_only" },
      },
      {
        check: "permissions.config_file",
        level: "fail",
        message: { key: "check.open", values: { path: configFile } },
        details: { path: configFile, access: "open" },
      },
      {
        check: "permissions.cli_token",
        level: "ok",
        details: { path: token, access: "owner_only" },
      },
    ]);
    expect(restricted).toStrictEqual([]);
  });

  it("restricts what others can open with --fix, folders as folders, and reads it again", async () => {
    const { platform, restricted } = platformWith(
      new Map([
        [root, "open"],
        [configFile, "owner_only"],
        [keys, "open"],
      ]),
    );
    const findings = await accessFindings({ platform, fix: true, signal: live() });
    expect(restricted).toStrictEqual([`${root}/`, `${keys}/`]);
    expect(findings.map((finding) => [finding.check, finding.level, finding.fixed])).toStrictEqual([
      ["permissions.state_folder", "ok", { key: "check.fixed", values: { path: root } }],
      ["permissions.config_file", "ok", undefined],
      ["permissions.keys_folder", "ok", { key: "check.fixed", values: { path: keys } }],
    ]);
  });

  it("skips what this system cannot read, and restricts it all the same with --fix", async () => {
    const { platform, restricted } = platformWith(
      new Map([
        [root, "unknown"],
        [configFile, "unknown"],
      ]),
    );
    const checked = await accessFindings({ platform, fix: false, signal: live() });
    expect(checked.map((finding) => finding.level)).toStrictEqual(["skip", "skip"]);
    const fixed = await accessFindings({ platform, fix: true, signal: live() });
    expect(restricted).toStrictEqual([`${root}/`, configFile]);
    expect(fixed.map((finding) => [finding.level, finding.details?.["fixed"]])).toStrictEqual([
      ["skip", true],
      ["skip", true],
    ]);
  });
});
