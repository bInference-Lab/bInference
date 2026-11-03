import { z } from "zod";
import { tailscaleJson } from "./tailscale-json.js";

/** This machine as `tailscale status --json` describes it, in what remote access needs. */
export interface TailscaleNode {
  /** Whether the daemon is up and signed in: its backend state is `Running`. */
  readonly running: boolean;
  /** Its MagicDNS name without the trailing dot, such as `box.tail1234.ts.net`, when it has one. */
  readonly name?: string;
  /** Whether the tailnet gives it HTTPS certificates: its `https` capability. */
  readonly https: boolean;
  /** Whether the tailnet's policy lets it use `funnel`: its `funnel` node attribute. */
  readonly funnel: boolean;
  /** The port ranges its funnel-ports capability allows `funnel` on, each from and to inclusive. */
  readonly funnelPorts: readonly PortRange[];
}

/** Ports from `from` to `to`, both included. */
interface PortRange {
  readonly from: number;
  readonly to: number;
}

/** Whether the node's funnel-ports capability allows `funnel` on `port`. */
export function allowsFunnelOn(node: TailscaleNode, port: number): boolean {
  return node.funnelPorts.some((range) => range.from <= port && port <= range.to);
}

// Only the fields remote access reads; Tailscale says the rest of the format may change.
const statusSchema = z.object({
  BackendState: z.string(),
  Self: z
    .object({
      DNSName: z.string().nullish(),
      Capabilities: z.array(z.string()).nullish(),
      CapMap: z.record(z.string(), z.unknown()).nullish(),
    })
    .nullish(),
});

const funnelPortsCap = "https://tailscale.com/cap/funnel-ports?";

function isPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65_535;
}

// `443,8443` or ranges such as `8000-8010`, as Tailscale's own check reads the capability.
function portsOf(capability: string): readonly PortRange[] {
  const list = new URLSearchParams(capability.slice(funnelPortsCap.length)).get("ports") ?? "";
  return list.split(",").flatMap((part) => {
    const [low = "", high = low] = part.split("-");
    const range = { from: Number(low), to: Number(high) };
    return isPort(range.from) && isPort(range.to) && range.from <= range.to ? [range] : [];
  });
}

/**
 * Reads `tailscale status --json`: running only in the backend state `Running`; the name, and the
 * capabilities from `CapMap` and the older `Capabilities` list alike. Output that is not that JSON
 * answers `undefined`.
 */
export function tailscaleNodeOf(stdout: string): TailscaleNode | undefined {
  const status = tailscaleJson(stdout, statusSchema);
  if (status === undefined) {
    return undefined;
  }
  const self = status.Self;
  const caps = [...Object.keys(self?.CapMap ?? {}), ...(self?.Capabilities ?? [])];
  const name = (self?.DNSName ?? "").replace(/\.$/, "");
  const node = {
    running: status.BackendState === "Running",
    https: caps.includes("https"),
    funnel: caps.includes("funnel"),
    funnelPorts: caps.filter((cap) => cap.startsWith(funnelPortsCap)).flatMap(portsOf),
  };
  return name === "" ? node : { ...node, name };
}
