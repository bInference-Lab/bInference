import type { McpClient } from "../compose/mcp-token.js";
import type { CliHost } from "../program/cli-host.js";

/** What `binference mcp setup` sets up for a client. */
type SetupPart = "token" | "server" | "skill";

/** What a setup or a removal did to one part, or would do with `--dry-run`. */
type SetupAction = "created" | "updated" | "unchanged" | "removed" | "absent";

/** One part's change, and the file or folder it is in. */
export interface SetupChange {
  readonly part: SetupPart;
  readonly action: SetupAction;
  readonly path: string;
  /** When a token made by this run stops working, if it expires. */
  readonly expiresAt?: number;
}

/** One run of the setup: the host, the client, whether it only shows the changes, its signal. */
export interface SetupRun {
  readonly host: CliHost;
  readonly client: McpClient;
  readonly isDryRun: boolean;
  readonly signal: AbortSignal;
  /** How long a new token works; it works until it is revoked when left out. */
  readonly ttlMs?: number;
}
