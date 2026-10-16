import { createSecret, type Secret } from "@binference/core";
import { createSeededRandom } from "@binference/core/testing";
import { issueLaunchTicket } from "@binference/engine/access";
import type { OpenFrame } from "@binference/protocol";
import { telegramLaunchHash } from "../telegram-launch.js";
import type { TestServer } from "./test-server.js";

/** The owner's bot token the test launches are signed with. */
export const botToken: Secret = createSecret("7012345678:AAE_fakeTokenForTestsOnly_0123456789ab");
/** The owner's numeric Telegram id. */
export const ownerId = 279_058_397;

/** One Mini App launch: who opened it, and when. */
export interface Launch {
  readonly userId: number;
  readonly atMs: number;
  readonly query?: string;
}

/** The fields of a launch as Telegram sends them to the Mini App, before it signs them. */
export function fieldsOf(launch: Launch): Map<string, string> {
  return new Map([
    ["query_id", launch.query ?? "AAHdF6IQAAAAAN0XohDhrOrc"],
    ["user", JSON.stringify({ id: launch.userId, first_name: "Ada", language_code: "en" })],
    ["auth_date", String(Math.floor(launch.atMs / 1_000))],
  ]);
}

/** A launch's `initData`, signed as Telegram signs it with the owner's bot token. */
export function initDataOf(fields: ReadonlyMap<string, string>): string {
  return new URLSearchParams([
    ...fields,
    ["hash", telegramLaunchHash(fields, botToken)],
  ]).toString();
}

/** The Mini App's `open`, with the launch ticket when it has one. */
export function miniOpen(initData: string, ticket?: string): OpenFrame {
  const telegram = ticket === undefined ? { initData } : { initData, ticket };
  return { t: "open", v: 1, client: { kind: "mini", version: "console" }, auth: { telegram } };
}

let ticketSeed = 0;

/** A launch ticket `/console` made for the owner now. */
export async function ticketFor(server: TestServer): Promise<string> {
  ticketSeed += 1;
  const options = { ...server, random: createSeededRandom(ticketSeed) };
  return issueLaunchTicket(options, { userId: ownerId, signal: AbortSignal.timeout(1_000) });
}
