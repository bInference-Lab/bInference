import { z } from "zod";

/** Each act the sandbox refuses a community plugin, which the probe tries (decision 0343). */
export const probeActs = [
  "readOutside",
  "writeOutside",
  "link",
  "hardLink",
  "fetch",
  "connect",
  "lookup",
  "listen",
  "udp",
  "childProcess",
  "worker",
  "addon",
  "wasi",
  "ffi",
  "ffiMemory",
  "inspector",
  "sqlite",
  "binding",
  "setFlags",
  "debugSignal",
  "signal",
] as const;

/** One act of {@link probeActs}. */
export type ProbeAct = (typeof probeActs)[number];

/**
 * What one act met: `refused` by Node or the OS, `allowed`, or `failed` for another error, which
 * proves nothing either way.
 */
export type ProbeOutcome = "refused" | "allowed" | "failed";

/** The probe's report: each act's outcome. */
export type ProbeReport = Readonly<Record<ProbeAct, ProbeOutcome>>;

/** One act of the probe: what it starts, which may be an emitter such as a socket. */
export type ProbeAttempt = () => unknown;

// The codes with which Node or the OS refuses an act: the permission model, the addon switch, a
// module the process was started without, and a signal to another user's process.
const refusalCodes = new Set([
  "ERR_ACCESS_DENIED",
  "ERR_DLOPEN_DISABLED",
  "ERR_UNKNOWN_BUILTIN_MODULE",
  "EPERM",
]);

const coded = z.object({ code: z.string() });
const withCause = z.object({ cause: coded });

/** Whether an error an act threw is Node's or the OS's refusal, for it or the cause it wraps. */
function outcomeOfError(error: unknown): ProbeOutcome {
  const own = coded.safeParse(error);
  const cause = withCause.safeParse(error);
  const codes = [own.success ? own.data.code : "", cause.success ? cause.data.cause.code : ""];
  return codes.some((code) => refusalCodes.has(code)) ? "refused" : "failed";
}

// An act that answers an emitter, such as a socket, ends at its first event: an error is its
// outcome, any other event means it was allowed.
async function settle(handle: unknown): Promise<ProbeOutcome> {
  const once: unknown =
    typeof handle === "object" && handle !== null ? Reflect.get(handle, "once") : undefined;
  if (typeof once !== "function") {
    return "allowed";
  }
  return new Promise((resolve) => {
    Reflect.apply(once, handle, ["error", (error: unknown) => resolve(outcomeOfError(error))]);
    for (const event of ["connect", "listening", "spawn", "online"]) {
      Reflect.apply(once, handle, [event, () => resolve("allowed")]);
    }
  });
}

/** Runs one act and answers what it met: thrown, rejected, or the first event of its emitter. */
export async function attemptAct(act: ProbeAttempt): Promise<ProbeOutcome> {
  try {
    return await settle(await act());
  } catch (error) {
    return outcomeOfError(error);
  }
}

/**
 * Calls a function Node does not type, such as `process._debugProcess`, `process.binding` or
 * `dlopen` of `node:ffi`, by its name on its owner; a name the owner lacks throws, which the probe
 * reports as `failed`.
 */
export function callUntyped(owner: unknown, name: string, args: readonly unknown[]): unknown {
  const found: unknown =
    typeof owner === "object" && owner !== null ? Reflect.get(owner, name) : undefined;
  if (typeof found !== "function") {
    throw new TypeError(`${name} is not a function`);
  }
  return Reflect.apply(found, owner, args);
}

/** What the probe needs: a file and a folder outside its own, and the decoy's process id. */
export interface ProbeConfig {
  readonly outsideFile: string;
  readonly outsideFolder: string;
  readonly decoyPid: number;
}

const probeConfigSchema: z.ZodType<ProbeConfig> = z.strictObject({
  outsideFile: z.string(),
  outsideFolder: z.string(),
  decoyPid: z.int().positive(),
});

/** Reads the probe's config from its tool call's settings. */
export function probeConfigOf(config: unknown): ProbeConfig {
  return probeConfigSchema.parse(config);
}

const outcomeSchema = z.enum(["refused", "allowed", "failed"]);

/** The schema of {@link ProbeReport}, which the host reads from the probe's answer. */
export const probeReportSchema: z.ZodType<ProbeReport> = z.strictObject({
  readOutside: outcomeSchema,
  writeOutside: outcomeSchema,
  link: outcomeSchema,
  hardLink: outcomeSchema,
  fetch: outcomeSchema,
  connect: outcomeSchema,
  lookup: outcomeSchema,
  listen: outcomeSchema,
  udp: outcomeSchema,
  childProcess: outcomeSchema,
  worker: outcomeSchema,
  addon: outcomeSchema,
  wasi: outcomeSchema,
  ffi: outcomeSchema,
  ffiMemory: outcomeSchema,
  inspector: outcomeSchema,
  sqlite: outcomeSchema,
  binding: outcomeSchema,
  setFlags: outcomeSchema,
  debugSignal: outcomeSchema,
  signal: outcomeSchema,
});
