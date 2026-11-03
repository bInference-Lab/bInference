import { createIdSource, err, jsonValueSchema, ok, type Random } from "@binference/core";
import type { EngineCaller, EngineHandler, PublishPush } from "@binference/engine";
import type { EngineHandlerTable } from "@binference/engine/surfaces";
import type { ProtocolErrorCode, ProtocolId, RemoteDisabled } from "@binference/protocol";
import { publishRemote, type Unpublished, unpublishRemote } from "../remote/publish-remote.js";
import type { RemotePart } from "../remote/remote-handlers.js";
import { findTailscale } from "../remote/tailscale-cli.js";
import type { RemoteFailure } from "../remote/tailscale-commands.js";
import type { Closers } from "./closers.js";
import type { Opened, Opening } from "./open-engine-parts.js";
import { type RemoteReading, remoteReadingOf } from "./remote-reading.js";

/** What the remote access operations read, change and tell. */
export interface RemoteOperationsOptions {
  readonly reading: RemoteReading;
  readonly random: Random;
  /** The `config/change` that writes `config.json5` and journals it as the caller's. */
  readonly configChange: EngineHandler<"config/change">;
  /** The engine's one publish; a job's end goes to the `job` topic. */
  readonly publish: PublishPush;
  /** Where the operations add what stops a job under way. */
  readonly closers: Closers;
}

const op = "remote/enable";
const remoteParts: readonly RemotePart[] = ["mini", "webhooks"];
// The CLI waits this long for a job (decision 0340); past it the job stops and undoes.
const jobMs = 90_000;
// A record is written on the engine's own time, never on a request a change may have cut.
const recordMs = 15_000;

/** One remote job: what it publishes, and what stops it. */
interface RemoteJob {
  readonly id: ProtocolId<"longJob">;
  readonly parts: readonly RemotePart[];
  readonly stop: AbortController;
}

// A JSON merge patch of the `remote` group.
type Patch = Readonly<Record<"remote", Readonly<Record<string, boolean | string | null>>>>;

function codeOf(failure: RemoteFailure): ProtocolErrorCode {
  return `remote.${failure}`;
}

// Writes what Tailscale holds, as the caller's change, so the reload journals and tells it.
async function record(
  options: RemoteOperationsOptions,
  change: { readonly patch: Patch; readonly caller: EngineCaller },
  signal: AbortSignal,
): Promise<ProtocolErrorCode | undefined> {
  const args = { patch: change.patch, reason: "binference expose" };
  const changed = await options.configChange({ args, caller: change.caller, signal });
  return changed.ok ? undefined : changed.error;
}

// The records after a publish; an address the owner set in `remote.publicUrl` stays.
function publishedPatch(
  options: RemoteOperationsOptions,
  parts: readonly RemotePart[],
  name: string,
): Patch {
  const url = `https://${name}`;
  const { publicUrl } = options.reading.parts.record();
  const address = publicUrl === undefined || publicUrl === url ? { publicUrl: url } : {};
  const mini = parts.includes("mini") ? { mini: true, ...address } : {};
  return { remote: { ...mini, ...(parts.includes("webhooks") ? { webhooks: true } : {}) } };
}

// The records after `--off`, from what Tailscale holds; `remote.publicUrl` goes only when it names
// the Mini App's Tailscale address and the Mini App is not published there.
function offPatch(options: RemoteOperationsOptions, after: Unpublished): Patch {
  const { publicUrl } = options.reading.parts.record();
  const isOurs = after.name !== undefined && publicUrl === `https://${after.name}`;
  const address = isOurs && !after.published.mini ? { publicUrl: null } : {};
  return { remote: { ...after.published, ...address } };
}

function pushEnd(options: RemoteOperationsOptions, end: object): void {
  const kind = "error" in end ? "job/failed" : "job/done";
  options.publish({ topic: "job", kind, data: jsonValueSchema.parse({ op, ...end }) });
}

async function runEnable(
  options: RemoteOperationsOptions,
  job: RemoteJob & { readonly caller: EngineCaller },
  signal: AbortSignal,
): Promise<void> {
  const run = await findTailscale(options.reading.parts.host);
  const { ports } = options.reading.parts;
  const published = await publishRemote(run, { parts: job.parts, ports }, signal);
  options.reading.forget();
  const failed = published.ok
    ? await record(
        options,
        { patch: publishedPatch(options, job.parts, published.value), caller: job.caller },
        signal,
      )
    : codeOf(published.error);
  if (failed !== undefined) {
    const error = { code: failed, message: `Remote access failed: ${failed}.`, retryable: false };
    pushEnd(options, { job: job.id, error });
    return;
  }
  pushEnd(options, { job: job.id, result: await options.reading.view() });
}

/**
 * The handlers of `remote/status`, `remote/enable` and `remote/disable` (protocol spec, section
 * 7.9; decisions 0340 and 0341), one remote job at a time.
 *
 * - Status answers the reading's view, kept 5 seconds.
 * - Enable answers a job at once: the running one for the same parts, else a new one that runs
 *   after it. The job publishes the parts, writes `remote.mini`, `remote.publicUrl` (unless it
 *   names an address the owner set) and `remote.webhooks` through `config/change`, and ends with
 *   the view, or fails with a `remote` code having undone what it set, within 90 seconds. A
 *   `config.json5` that refuses the record fails the job with its `config` code, the handlers
 *   left published, so the next `binference expose` records them again. A request with neither
 *   part is `protocol.bad_args`.
 * - Disable stops every job and waits for its undo, takes off binference's handlers, then writes
 *   the records from what Tailscale holds, on the engine's own time, and answers what still
 *   publishes the engine's or the webhook listener's port.
 *
 * Its closer stops a job under way and waits for its undo.
 */
export function createRemoteOperations(options: RemoteOperationsOptions): EngineHandlerTable {
  const ids = createIdSource({ clock: options.reading.parts.clock, random: options.random });
  const shutdown = new AbortController();
  const queue: { jobs: RemoteJob[]; tail: Promise<void> } = { jobs: [], tail: Promise.resolve() };
  const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
    const done = queue.tail.then(work);
    queue.tail = done.then(
      () => undefined,
      () => undefined,
    );
    return done;
  };
  options.closers.add("remote jobs", async () => {
    shutdown.abort();
    await queue.tail;
  });
  return {
    "remote/status": async () => ok(await options.reading.view()),
    "remote/enable": async ({ args, caller }) => {
      const parts = remoteParts.filter((part) => args[part] === true);
      if (parts.length === 0) {
        return err("protocol.bad_args");
      }
      const same = queue.jobs.find((job) => job.parts.join() === parts.join());
      if (same !== undefined) {
        return ok({ job: same.id });
      }
      const job = { id: ids.next("job"), parts, stop: new AbortController() };
      const signal = AbortSignal.any([
        shutdown.signal,
        job.stop.signal,
        AbortSignal.timeout(jobMs),
      ]);
      queue.jobs.push(job);
      void enqueue(async () => runEnable(options, { ...job, caller }, signal)).finally(() => {
        queue.jobs = queue.jobs.filter((each) => each !== job);
      });
      return ok({ job: job.id });
    },
    "remote/disable": async ({ caller }) => {
      queue.jobs.forEach((job) => job.stop.abort());
      return enqueue(async () => disable(options, caller, shutdown.signal));
    },
  };
}

async function disable(
  options: RemoteOperationsOptions,
  caller: EngineCaller,
  shutdown: AbortSignal,
) {
  const signal = AbortSignal.any([shutdown, AbortSignal.timeout(recordMs + jobMs)]);
  const { parts } = options.reading;
  const isRecorded = parts.record().mini || parts.record().webhooks;
  const run = await findTailscale(parts.host);
  const removed = await unpublishRemote(run, { ports: parts.ports, isRecorded }, signal);
  options.reading.forget();
  if (!removed.ok) {
    return err(codeOf(removed.error));
  }
  const ownTime = AbortSignal.any([shutdown, AbortSignal.timeout(recordMs)]);
  const failed = await record(
    options,
    { patch: offPatch(options, removed.value), caller },
    ownTime,
  );
  if (failed !== undefined) {
    return err(failed);
  }
  const { left } = removed.value;
  const answer: RemoteDisabled = left.length === 0 ? {} : { stillPublished: left };
  return ok(answer);
}

/**
 * The remote access operations of the self-hosted engine, over the engine's remote reading and
 * `config/change`; a job's end goes to `publish`.
 */
export function composeRemoteOperations(
  opening: Opening,
  opened: Opened,
  parts: { readonly publish: PublishPush; readonly configChange: EngineHandler<"config/change"> },
): EngineHandlerTable {
  return createRemoteOperations({
    reading: remoteReadingOf(opening, opened),
    random: opening.host.random,
    closers: opening.closers,
    ...parts,
  });
}
