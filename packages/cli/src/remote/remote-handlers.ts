import { isLoopbackHost } from "@binference/server";
import type { ServeConfig, ServeHandler } from "./serve-config.js";

const miniHttpsPort = 443;
/** The HTTPS port the webhook path takes, public under `funnel` (decision 0340). */
export const webhookHttpsPort = 8443;
/** The one mount point `funnel` publishes on the webhook port. */
export const webhookMount = "/hook/";

/** The two parts `binference expose` publishes. */
export type RemotePart = "mini" | "webhooks";

/** The loopback ports binference's handlers reach: the engine's and the webhook listener's. */
export interface LoopbackPorts {
  readonly engine: number;
  readonly webhooks: number;
}

/** This machine's Tailscale name and the loopback ports binference's handlers reach. */
export interface RemotePlace {
  readonly name: string;
  readonly ports: LoopbackPorts;
}

// The unspecified addresses name every interface, so a proxy to one reaches this machine too.
const everyInterface: ReadonlySet<string> = new Set(["0.0.0.0", "::", "[::]"]);

// The port and path a proxy target or TCP forward reaches on this machine, else `undefined`:
// Tailscale keeps `http://127.0.0.1:7456`, and its CLI takes `localhost:7456` and `7456` too.
function localTarget(target: string): { readonly port: number; readonly path: string } | undefined {
  const full = /^\d+$/.test(target) ? `http://127.0.0.1:${target}` : target;
  try {
    const url = new URL(full.includes("://") ? full : `tcp://${full}`);
    const isLocal = isLoopbackHost(url.hostname) || everyInterface.has(url.hostname);
    return isLocal && url.port !== "" ? { port: Number(url.port), path: url.pathname } : undefined;
  } catch {
    return undefined;
  }
}

function reachesPort(target: string | undefined, port: number): boolean {
  return target !== undefined && localTarget(target)?.port === port;
}

function hostPort(name: string, port: number): string {
  return `${name}:${String(port)}`;
}

/** The port each part takes. */
export function httpsPortOf(part: RemotePart): number {
  return part === "mini" ? miniHttpsPort : webhookHttpsPort;
}

function mountOf(part: RemotePart): string {
  return part === "mini" ? "/" : webhookMount;
}

// Whether a handler is exactly the one binference sets for `part`: its mount, its target.
function isOurs(handler: ServeHandler, part: RemotePart, at: RemotePlace): boolean {
  const target = handler.proxy === undefined ? undefined : localTarget(handler.proxy);
  const port = part === "mini" ? at.ports.engine : at.ports.webhooks;
  const path = mountOf(part);
  return (
    handler.hostPort === hostPort(at.name, httpsPortOf(part)) &&
    handler.mount === path &&
    target?.port === port &&
    target.path === path
  );
}

function handlersAt(config: ServeConfig, key: string): readonly ServeHandler[] {
  return config.handlers.filter((handler) => handler.hostPort === key);
}

function portEntries(config: ServeConfig, port: number) {
  return config.ports.filter((entry) => entry.port === String(port));
}

/**
 * Whether binference's own handler of `part` is published as decision 0340 sets it: every entry of
 * its port serves HTTPS with that one handler, private for the Mini App, public under `funnel` for
 * the webhook path.
 */
export function isPublished(config: ServeConfig, at: RemotePlace, part: RemotePart): boolean {
  const port = httpsPortOf(part);
  const key = hostPort(at.name, port);
  const handlers = handlersAt(config, key);
  const entries = portEntries(config, port);
  return (
    entries.length > 0 &&
    entries.every((entry) => entry.https) &&
    handlers.length > 0 &&
    handlers.every((handler) => isOurs(handler, part, at)) &&
    config.funnel.has(key) === (part === "webhooks")
  );
}

/**
 * Whether the port of `part` holds binference's handler of it, at its mount to its target,
 * whatever its visibility: what an undo takes off after a call that may have stopped half way.
 */
export function holdsOurHandler(config: ServeConfig, at: RemotePlace, part: RemotePart): boolean {
  const key = hostPort(at.name, httpsPortOf(part));
  return handlersAt(config, key).some((handler) => isOurs(handler, part, at));
}

/**
 * Whether something binference did not set holds the port `part` takes, so `expose` changes
 * nothing (decision 0340): a TCP forward or plain HTTP there, any other web handler, or `funnel`
 * on the Mini App's port.
 */
export function isPortTaken(config: ServeConfig, at: RemotePlace, part: RemotePart): boolean {
  const port = httpsPortOf(part);
  const key = hostPort(at.name, port);
  return (
    portEntries(config, port).some((entry) => !entry.https) ||
    (part === "mini" && config.funnel.has(key)) ||
    handlersAt(config, key).some((handler) => !isOurs(handler, part, at))
  );
}

/**
 * Whether `funnel` publishes anything but binference's webhook handler (decision 0341): any other
 * public port, name, handler or TCP forward, whoever set it.
 */
export function publishesExtra(config: ServeConfig, at: RemotePlace): boolean {
  const ours = hostPort(at.name, webhookHttpsPort);
  return [...config.funnel].some(
    (key) =>
      key !== ours ||
      portEntries(config, webhookHttpsPort).some((entry) => !entry.https) ||
      handlersAt(config, key).some((handler) => !isOurs(handler, "webhooks", at)),
  );
}

// Whether a handler is binference's Mini App handler on its private port.
function isPrivateMini(config: ServeConfig, handler: ServeHandler, at: RemotePlace): boolean {
  return isOurs(handler, "mini", at) && !config.funnel.has(handler.hostPort);
}

/**
 * Whether a Tailscale handler or TCP forward reaches the engine's port other than binference's
 * private Mini App handler, whoever set it: a web handler on any other port, name or mount, one
 * made public, or a TCP forward, to any address of this machine.
 */
export function reachesEngine(config: ServeConfig, at: RemotePlace): boolean {
  const engine = at.ports.engine;
  return (
    config.handlers.some(
      (handler) => !isPrivateMini(config, handler, at) && reachesPort(handler.proxy, engine),
    ) || config.ports.some((entry) => reachesPort(entry.forward, engine))
  );
}

/** A handler or TCP forward that publishes one of binference's loopback ports. */
export interface PortHandler {
  readonly port: number;
  readonly mount?: string;
  readonly target: string;
  readonly isPublic: boolean;
}

function portOf(key: string): number {
  return Number(key.slice(key.lastIndexOf(":") + 1));
}

/**
 * Every handler and TCP forward that still publishes the engine's or the webhook listener's port,
 * on any port, private or public, whoever set it (decision 0341): what `--off` names as left.
 */
export function handlersReaching(config: ServeConfig, at: RemotePlace): readonly PortHandler[] {
  const ports = [at.ports.engine, at.ports.webhooks];
  const reaches = (target: string | undefined) => ports.some((port) => reachesPort(target, port));
  const web = config.handlers.flatMap((handler) =>
    handler.proxy !== undefined && reaches(handler.proxy)
      ? [
          {
            port: portOf(handler.hostPort),
            mount: handler.mount,
            target: handler.proxy,
            isPublic: config.funnel.has(handler.hostPort),
          },
        ]
      : [],
  );
  const forwards = config.ports.flatMap((entry) =>
    entry.forward !== undefined && reaches(entry.forward)
      ? [
          {
            port: Number(entry.port),
            target: entry.forward,
            isPublic: [...config.funnel].some((key) => portOf(key) === Number(entry.port)),
          },
        ]
      : [],
  );
  return [...web, ...forwards];
}
