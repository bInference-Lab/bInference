import { createHmac } from "node:crypto";
import { createProtocolClient, type ProtocolClient } from "@binference/client";
import type { Clock } from "@binference/core";
import { createMemoryLogger, createSeededRandom } from "@binference/core/testing";
import { operations } from "@binference/protocol";
import { fakeBotToken } from "@binference/telegram/testing";
import { WebSocket } from "ws";

/**
 * A launch's `initData` as Telegram signs it with the fake bot's token, by Telegram's rule: the
 * fields in key order make the data-check string. Another `queryId` makes another launch.
 */
export function signedLaunch(
  userId: number,
  atMs: number,
  queryId = "AAHdF6IQAAAAAN0XohDhrOrc",
): string {
  const fields = new URLSearchParams([
    ["auth_date", String(Math.floor(atMs / 1_000))],
    ["query_id", queryId],
    ["user", JSON.stringify({ id: userId, first_name: "Owner" })],
  ]);
  const checked = [...fields].map(([key, value]) => `${key}=${value}`).join("\n");
  const key = createHmac("sha256", "WebAppData").update(fakeBotToken).digest();
  fields.set("hash", createHmac("sha256", key).update(checked).digest("hex"));
  return fields.toString();
}

/**
 * A Mini App's protocol client, which signs in with a launch over the engine's WS at `origin`, or
 * at `address` when a proxy publishes the engine at `origin`.
 */
export function miniAppClient(at: {
  readonly origin: string;
  readonly address?: string;
  readonly initData: string;
  readonly clock: Clock;
}): ProtocolClient {
  const { origin, initData, clock } = at;
  const address = at.address ?? origin;
  return createProtocolClient({
    operations,
    openSocket: () => new WebSocket(`${address.replace("http", "ws")}/ws`, { origin }),
    client: { kind: "mini", version: "test" },
    credential: { telegram: { initData } },
    clock,
    random: createSeededRandom(29),
    logger: createMemoryLogger({ subsystem: "mini" }),
  });
}
