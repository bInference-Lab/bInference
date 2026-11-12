import { Buffer } from "node:buffer";
import { nestsDeeperThan, replaceNul } from "@binference/core";
import { z } from "zod";
import { maxWebhookAlertIdLength, type WebhookBody } from "./webhook-alert.js";

/** What the listener reads of an alert's body: the body to store, and its `id` when it has one. */
export interface AlertBody {
  readonly body: WebhookBody;
  readonly alertId?: string;
}

// A leading byte order mark stays in the text, so the stored text is the body as it came.
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

const alertIdSchema = z.string().min(1).max(maxWebhookAlertIdLength);

// An object, never an array or null; its keys pass through unread.
const objectSchema = z.looseObject({});

function textOf(bytes: Readonly<Uint8Array>): string | undefined {
  try {
    return utf8.decode(bytes);
  } catch {
    return undefined;
  }
}

// The body's JSON value, or `undefined` for a body that is not JSON.
function jsonOf(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function idOf(value: unknown): string | undefined {
  const holder = objectSchema.safeParse(value);
  if (!holder.success || !Object.hasOwn(holder.data, "id")) {
    return undefined;
  }
  const alertId = alertIdSchema.safeParse(holder.data["id"]);
  return alertId.success ? replaceNul(alertId.data) : undefined;
}

/**
 * Reads an alert's body (spec 1, section 2.2; decisions 0299 and 0333). Any body is an alert,
 * JSON or plain text: it is kept as its text when it is UTF-8 with no U+0000, else as its bytes in
 * base64, so no store meets U+0000 and the bytes stay as they came (decision 0416). Of a JSON
 * object only its own `id` is read, when it is a string of 1 to 128 characters, with U+FFFD in
 * place of each U+0000: the alert's repeat key beside the body itself. Nothing else in the body
 * is read. A JSON body nested past `maxJsonDepth` is `too_deep` (decision 0417): no alert.
 */
export function readAlertBody(bytes: Readonly<Uint8Array>): AlertBody | "too_deep" {
  const text = textOf(bytes);
  if (text === undefined || text.includes("\u0000")) {
    return { body: { base64: Buffer.from(bytes).toString("base64") } };
  }
  const value = jsonOf(text);
  if (value !== undefined && nestsDeeperThan(text)) {
    return "too_deep";
  }
  const alertId = idOf(value);
  return alertId === undefined ? { body: { text } } : { body: { text }, alertId };
}
