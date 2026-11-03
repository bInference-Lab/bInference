// oxlint-disable-next-line eslint/no-restricted-imports -- the probe tries each process the sandbox refuses
import { spawn } from "node:child_process";
import { createSocket } from "node:dgram";
import { lookup } from "node:dns/promises";
// oxlint-disable-next-line eslint/no-restricted-imports -- the probe tries each file the sandbox refuses
import { linkSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { open as openInspector } from "node:inspector";
import { connect, createServer } from "node:net";
import { join } from "node:path";
import process from "node:process";
import { setFlagsFromString } from "node:v8";
import { WASI } from "node:wasi";
import { Worker } from "node:worker_threads";
import { type CommunityTools, defineTools } from "@binference/plugin-sdk/community";
import {
  attemptAct,
  callUntyped,
  type ProbeAct,
  probeActs,
  type ProbeAttempt,
  probeConfigOf,
  type ProbeConfig,
} from "./probe-outcome.schema.js";

// The probe plugin (decision 0343): the plugin host runs it as a community plugin, through the
// same program, arguments and starter, before any other. Its one tool tries each act the sandbox
// refuses and answers what each met. Every network act aims at this machine's loopback, so an act
// the sandbox fails to refuse reaches nothing outside.

const loopback = "127.0.0.1";

function attemptsOf(config: ProbeConfig, here: string): Readonly<Record<ProbeAct, ProbeAttempt>> {
  return {
    readOutside: () => readFileSync(config.outsideFile),
    writeOutside: () => {
      writeFileSync(join(config.outsideFolder, "sandbox-probe.txt"), "probe");
    },
    link: () => {
      symlinkSync(config.outsideFolder, join(here, "sandbox-probe-link"));
    },
    hardLink: () => {
      linkSync(config.outsideFile, join(here, "sandbox-probe-hard"));
    },
    // oxlint-disable-next-line eslint/no-restricted-globals -- the probe tries the fetch the sandbox refuses
    fetch: async () => fetch(`http://${loopback}/`, { signal: AbortSignal.timeout(5_000) }),
    connect: () => connect(9, loopback),
    lookup: async () => lookup("localhost"),
    listen: () => createServer().listen(0),
    udp: () => createSocket("udp4").bind(0, loopback),
    childProcess: () => spawn(process.execPath, ["--version"]),
    worker: () => new Worker("0", { eval: true }),
    addon: () => {
      process.dlopen({ exports: {} }, join(here, "sandbox-probe.node"));
    },
    wasi: () => new WASI({ version: "preview1" }),
    ffi: async () => callUntyped(await import("node:ffi"), "dlopen", [null, {}]),
    ffiMemory: async () => callUntyped(await import("node:ffi"), "exportString", ["probe"]),
    inspector: () => openInspector(0, loopback),
    sqlite: async () => import("node:sqlite"),
    binding: () => callUntyped(process, "binding", ["fs"]),
    setFlags: () => {
      setFlagsFromString("--allow-natives-syntax");
    },
    debugSignal: () => callUntyped(process, "_debugProcess", [config.decoyPid]),
    signal: () => process.kill(config.decoyPid, 0),
  };
}

/** The probe's one tool, `probe`: each act of `probeActs` and what it met. */
export const tools: CommunityTools = defineTools({
  probe: async (_input, context) => {
    const attempts = attemptsOf(probeConfigOf(context.config), context.dataFolder);
    const outcomes = await Promise.all(probeActs.map(async (act) => attemptAct(attempts[act])));
    return Object.fromEntries(probeActs.map((act, index) => [act, outcomes[index] ?? "failed"]));
  },
});
