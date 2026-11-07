import { join } from "node:path";
import { type JsonValue, jsonValueSchema } from "@binference/core";
import {
  ensurePrivateFolder,
  type FileWatch,
  readTextFile,
  watchFile,
  writePrivateFile,
} from "@binference/platform";
import { writeStandInProgram } from "@binference/platform/testing";
import { z } from "zod";
import { createSystemClock } from "../runtime/system-clock.js";
import { noPermissions, testSystem } from "./test-host.js";

const files = { permissions: noPermissions, signal: new AbortController().signal };
const callSchema = z.array(z.string());

function jsonOrUndefined(text: string): JsonValue | undefined {
  try {
    return jsonValueSchema.parse(JSON.parse(text));
  } catch {
    return undefined;
  }
}
const stateSchema = z.object({ serve: jsonValueSchema });

/** What the stand-in Tailscale answers and keeps, in the shapes the real CLI prints. */
export interface FakeTailscaleState {
  /** What `tailscale status --json` prints. */
  readonly status: JsonValue;
  /** What `tailscale serve status --json` prints, changed by each `serve` and `funnel` call. */
  readonly serve: JsonValue;
  /** A daemon that is not running: every call fails as the real CLI does then. */
  readonly daemon?: "down";
  /** Each call of `command` that sets a handler refused with `text` on standard error and 1. */
  readonly refuse?: { readonly command: "serve" | "funnel"; readonly text: string };
  /** Each call that takes a handler off refused with this text on standard error and 1. */
  readonly refuseOff?: string;
  /** A change that exits 0 but leaves the config as it was, as with HTTPS off. */
  readonly ignore?: boolean;
  /**
   * Each call of `command` that sets a handler applies it, then waits `ms` before it exits; with
   * `before`, it waits first and applies the change only once the wait ends.
   */
  readonly hang?: {
    readonly command: "serve" | "funnel";
    readonly ms: number;
    readonly before?: boolean;
  };
}

/** A stand-in `tailscale` on a folder of its own, and how a test reads what it did. */
export interface FakeTailscale {
  /** The environment that puts it on `PATH`, and only it. */
  readonly env: { readonly PATH: string };
  /** A host that finds it on that `PATH`, as a test machine's host would. */
  readonly host: { readonly env: { readonly PATH: string }; readonly system: typeof testSystem };
  /** Every command line it ran, in order. */
  calls(): Promise<readonly (readonly string[])[]>;
  /** Its `serve status --json` config as it stands. */
  serve(): Promise<JsonValue>;
  /** Resolves once its serve config, as it writes it, holds what `holds` looks for. */
  untilServe(holds: (serve: JsonValue) => boolean): Promise<void>;
  /** Resolves once it was called with a command line `holds` looks for. */
  untilCalled(holds: (call: readonly string[]) => boolean): Promise<void>;
  /** Replaces what it answers from now on. */
  set(state: FakeTailscaleState): Promise<void>;
}

// The stand-in: it records each call, answers the reads from its state file, and applies a
// `serve` or `funnel` change, `off` included, to the config as Tailscale's CLI does: a `serve` on
// a port removes its funnel. It never runs the real Tailscale.
const script = String.raw`
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
const stateFile = new URL("./tailscale-state.json", import.meta.url);
const state = JSON.parse(readFileSync(stateFile, "utf8"));
const args = process.argv.slice(2);
appendFileSync(new URL("./tailscale-calls.jsonl", import.meta.url), JSON.stringify(args) + "\n");
const fail = (text) => { process.stderr.write(text + "\n"); process.exit(1); };
if (state.daemon === "down") fail("failed to connect to local tailscaled; it doesn't appear to be running");
const [command, ...rest] = args;
const print = (value) => { process.stdout.write(JSON.stringify(value) + "\n"); process.exit(0); };
if (command === "status") print(state.status);
if (command !== "serve" && command !== "funnel") fail("unknown command " + command);
if (rest[0] === "status") print(state.serve);
const target = rest.filter((a) => !a.startsWith("--")).at(-1);
if (state.refuse?.command === command && target !== "off") fail(state.refuse.text);
if (state.refuseOff !== undefined && target === "off") fail(state.refuseOff);
const flags = Object.fromEntries(rest.filter((a) => a.startsWith("--") && a.includes("=")).map((a) => a.slice(2).split("=")));
const port = flags.https;
const mount = flags["set-path"] ?? "/";
// Applies the change to the state as it stands then, read again in case it moved meanwhile.
const change = () => {
  const now = JSON.parse(readFileSync(stateFile, "utf8"));
  const key = now.status.Self.DNSName.replace(/\.$/, "") + ":" + port;
  now.serve ??= {};
  const serve = now.serve;
  serve.TCP ??= {}; serve.Web ??= {}; serve.AllowFunnel ??= {};
  if (now.ignore !== true && target === "off") {
    const handlers = serve.Web[key]?.Handlers ?? {};
    if (!(mount in handlers)) fail("error: handler does not exist");
    delete handlers[mount];
    if (Object.keys(handlers).length === 0) { delete serve.Web[key]; delete serve.TCP[port]; delete serve.AllowFunnel[key]; }
  } else if (now.ignore !== true) {
    serve.TCP[port] = { HTTPS: true };
    serve.Web[key] ??= { Handlers: {} };
    serve.Web[key].Handlers[mount] = { Proxy: target };
    if (command === "funnel") serve.AllowFunnel[key] = true; else delete serve.AllowFunnel[key];
  }
  writeFileSync(stateFile, JSON.stringify(now));
};
const hang = state.hang?.command === command && target !== "off" ? state.hang : undefined;
if (hang === undefined) { change(); process.exit(0); }
else if (hang.before === true) setTimeout(() => { change(); process.exit(0); }, hang.ms);
else { change(); setTimeout(() => process.exit(0), hang.ms); }
`;

// Resolves once `holds` answers true, asked at once and on each change of `file`.
async function untilFile(file: string, holds: () => Promise<boolean>): Promise<void> {
  const watches: FileWatch[] = [];
  const reached = new Promise<void>((resolve, reject) => {
    const check = async (): Promise<void> => {
      if (await holds()) {
        resolve();
      }
    };
    watches.push(
      watchFile(file, {
        onChange: () => void check(),
        onError: reject,
        clock: createSystemClock(),
      }),
    );
    void check();
  });
  await reached.finally(() => watches.forEach((watch) => watch.close()));
}

/** The machine's name in every fake status. */
export const fakeTailnetName = "box.tail1234.ts.net";

/**
 * `tailscale status --json --peers=false` of a machine signed in as `box.tail1234.ts.net`, with
 * HTTPS and the funnel attribute on ports 443, 8443 and 10000 unless a test takes them away.
 */
export function fakeStatus(
  options: { readonly backend?: string; readonly caps?: readonly string[] } = {},
): JsonValue {
  const caps = options.caps ?? [
    "https",
    "funnel",
    "https://tailscale.com/cap/funnel-ports?ports=443,8443,10000",
  ];
  return {
    BackendState: options.backend ?? "Running",
    Self: {
      DNSName: `${fakeTailnetName}.`,
      CapMap: Object.fromEntries(caps.map((cap) => [cap, null])),
    },
  };
}

/**
 * Writes a stand-in `tailscale` into `folder`, with `state`, on macOS, Linux and Windows alike: a
 * shell script or a `.cmd` file that runs the script with this Node.
 */
export async function writeFakeTailscale(
  folder: string,
  state: FakeTailscaleState,
): Promise<FakeTailscale> {
  await ensurePrivateFolder(folder, files);
  const stateFile = join(folder, "tailscale-state.json");
  const set = async (next: FakeTailscaleState) =>
    writePrivateFile(stateFile, JSON.stringify(next), files);
  await set(state);
  await writeStandInProgram(folder, "tailscale", script);
  const read = async (file: string) => {
    const text = await readTextFile(join(folder, file), files.signal);
    return text.ok ? text.value : "";
  };
  return {
    env: { PATH: folder },
    host: { env: { PATH: folder }, system: testSystem },
    calls: async () =>
      (await read("tailscale-calls.jsonl"))
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => callSchema.parse(JSON.parse(line))),
    serve: async () => stateSchema.parse(JSON.parse(await read("tailscale-state.json"))).serve,
    untilServe: async (holds) =>
      untilFile(stateFile, async () => {
        // The stand-in writes its state in place, so a read may meet half a file.
        const parsed = stateSchema.safeParse(jsonOrUndefined(await read("tailscale-state.json")));
        return parsed.success && holds(parsed.data.serve);
      }),
    untilCalled: async (holds) =>
      untilFile(join(folder, "tailscale-calls.jsonl"), async () => {
        const lines = (await read("tailscale-calls.jsonl")).split("\n");
        return lines.some((line) => {
          const call = callSchema.safeParse(jsonOrUndefined(line));
          return call.success && holds(call.data);
        });
      }),
    set,
  };
}
