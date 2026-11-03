import { z } from "zod";
import { epochMsSchema } from "../values/epoch-ms.schema.js";

/**
 * What `binference check` fails about remote access (decisions 0051, 0340 and 0341): Tailscale is
 * not signed in, the tailnet has no HTTPS certificates, its policy denies this machine `funnel`,
 * `funnel` publishes more than the webhook path, the engine's port answers beyond loopback, or
 * Tailscale holds other than what binference recorded it published.
 */
export type RemoteProblem =
  | "logged_out"
  | "https_off"
  | "funnel_denied"
  | "funnel_extra"
  | "engine_exposed"
  | "serve_changed";

/**
 * Tailscale's state and what binference published through it, as `remote/status` answers and a
 * `remote/enable` job ends with it (protocol spec, section 7.9).
 */
export interface RemoteView {
  readonly tailscale: "absent" | "stopped" | "running";
  /** The Mini App's `serve` address while binference's handler is there. */
  readonly miniUrl?: string;
  /** The `funnel` base of the webhook path, on its own port, while binference's handler is there. */
  readonly webhookUrl?: string;
  /** What binference's own handlers publish now, read from Tailscale while it runs. */
  readonly published?: { readonly mini: boolean; readonly webhooks: boolean };
  readonly problems?: readonly RemoteProblem[];
  /** When Tailscale was read. */
  readonly checkedAt?: number;
}

/**
 * A Tailscale handler that publishes the engine's or the webhook listener's port, which
 * `remote/disable` left because binference did not set it as it is (decision 0341): a web handler
 * at `mount` on HTTPS `port`, or a TCP forward of `port` when there is no mount.
 */
interface LeftHandler {
  readonly port: number;
  readonly mount?: string;
  /** Where it forwards, as Tailscale keeps it, such as `http://127.0.0.1:7456`. */
  readonly target: string;
  /** Whether `funnel` makes it public; else only the tailnet reaches it. */
  readonly isPublic: boolean;
}

/** The answer of `remote/disable`: what still publishes binference's ports, when anything does. */
export interface RemoteDisabled {
  readonly stillPublished?: readonly LeftHandler[];
}

const url = z.string().min(1);

/** Parses a {@link RemoteDisabled}. */
export const remoteDisabledSchema: z.ZodType<RemoteDisabled> = z.object({
  stillPublished: z
    .array(
      z.object({
        port: z.int().min(1).max(65_535),
        mount: z.string().exactOptional(),
        target: z.string(),
        isPublic: z.boolean(),
      }),
    )
    .exactOptional(),
});
const remoteProblems = [
  "logged_out",
  "https_off",
  "funnel_denied",
  "funnel_extra",
  "engine_exposed",
  "serve_changed",
] as const satisfies readonly RemoteProblem[];

/** Parses a {@link RemoteView}. */
export const remoteViewSchema: z.ZodType<RemoteView> = z.object({
  tailscale: z.enum(["absent", "stopped", "running"]),
  miniUrl: url.exactOptional(),
  webhookUrl: url.exactOptional(),
  published: z.object({ mini: z.boolean(), webhooks: z.boolean() }).exactOptional(),
  problems: z.array(z.enum(remoteProblems)).exactOptional(),
  checkedAt: epochMsSchema.exactOptional(),
});
