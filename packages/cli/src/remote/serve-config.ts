import { z } from "zod";
import { tailscaleJson } from "./tailscale-json.js";

/**
 * One web handler: the `<name>:<port>` and mount point Tailscale files it under, and its proxy
 * target, or none for a file, a folder, text or a redirect, which no handler of binference serves.
 */
export interface ServeHandler {
  readonly hostPort: string;
  readonly mount: string;
  readonly proxy?: string;
}

/** What one port of the machine does: HTTPS, plain HTTP, or a TCP forward to `forward`. */
export interface ServePort {
  readonly port: string;
  readonly https: boolean;
  readonly forward?: string;
}

/**
 * Everything `tailscale serve status --json` says the machine publishes, background and
 * foreground sessions alike and each entry of each kept, under the names Tailscale gives: ports,
 * web handlers, and the `<name>:<port>` that `funnel` makes public.
 */
export interface ServeConfig {
  readonly ports: readonly ServePort[];
  readonly handlers: readonly ServeHandler[];
  readonly funnel: ReadonlySet<string>;
}

const handlerSchema = z.object({ Proxy: z.string().nullish() });
const portSchema = z.object({
  HTTPS: z.boolean().nullish(),
  HTTP: z.boolean().nullish(),
  TCPForward: z.string().nullish(),
});
const layerShape = {
  TCP: z.record(z.string(), portSchema).nullish(),
  Web: z
    .record(z.string(), z.object({ Handlers: z.record(z.string(), handlerSchema).nullish() }))
    .nullish(),
  AllowFunnel: z.record(z.string(), z.boolean()).nullish(),
};
const layerSchema = z.object(layerShape);
const serveStatusSchema = z.object({
  ...layerShape,
  Foreground: z.record(z.string(), layerSchema).nullish(),
});

type Layer = z.infer<typeof layerSchema>;

function portsOf(layers: readonly Layer[]): readonly ServePort[] {
  return layers.flatMap((layer) =>
    Object.entries(layer.TCP ?? {}).map(([port, value]) => {
      const forward = value.TCPForward ?? "";
      return forward === ""
        ? { port, https: value.HTTPS === true }
        : { port, https: false, forward };
    }),
  );
}

function handlersOf(layers: readonly Layer[]): readonly ServeHandler[] {
  return layers.flatMap((layer) =>
    Object.entries(layer.Web ?? {}).flatMap(([hostPort, value]) =>
      Object.entries(value.Handlers ?? {}).map(([mount, handler]) => {
        const proxy = handler.Proxy ?? "";
        return proxy === "" ? { hostPort, mount } : { hostPort, mount, proxy };
      }),
    ),
  );
}

function funnelOf(layers: readonly Layer[]): ReadonlySet<string> {
  const allowed = layers.flatMap((layer) => Object.entries(layer.AllowFunnel ?? {}));
  return new Set(allowed.filter(([, isOn]) => isOn).map(([hostPort]) => hostPort));
}

/**
 * Reads `tailscale serve status --json`, the background config and each foreground session's
 * together, since both publish. An empty config prints `{}`, or `null` from an older CLI; other
 * output answers `undefined`.
 */
export function serveConfigOf(stdout: string): ServeConfig | undefined {
  const status =
    stdout.trim() === "null"
      ? serveStatusSchema.parse({})
      : tailscaleJson(stdout, serveStatusSchema);
  if (status === undefined) {
    return undefined;
  }
  const layers = [status, ...Object.values(status.Foreground ?? {})];
  return { ports: portsOf(layers), handlers: handlersOf(layers), funnel: funnelOf(layers) };
}
