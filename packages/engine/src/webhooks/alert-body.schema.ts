import { Buffer } from "node:buffer";
import { z } from "zod";
import { maxWebhookAlertIdLength, type WebhookBody } from "./webhook-alert.js";

/** What the listener reads of an alert's body: the body to store, and its `id` when it has one. */
export interface AlertBody {
  readonly body: WebhookBody;
  readonly alertId?: string;
}

const utf8 = new TextDecoder("utf-8", { fatal: true });

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

function idOf(text: string): string | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  const holder = objectSchema.safeParse(value);
  if (!holder.success || !Object.hasOwn(holder.data, "id")) {
    return undefined;
  }
  const alertId = alertIdSchema.safeParse(holder.data["id"]);
  return alertId.success ? alertId.data : undefined;
}

/**
 * Reads an alert's body (spec 1, section 2.2; decisions 0299 and 0333). Any body is an alert,
 * JSON or plain text: it is kept as its text when it is UTF-8, else as its bytes in base64. Of a
 * JSON object only its own `id` is read, when it is a string of 1 to 128 characters: the alert's
 * repeat key beside the body itself. Nothing else in the body is read.
 */
export function readAlertBody(bytes: Readonly<Uint8Array>): AlertBody {
  const text = textOf(bytes);
  if (text === undefined) {
    return { body: { base64: Buffer.from(bytes).toString("base64") } };
  }
  const alertId = idOf(text);
  return alertId === undefined ? { body: { text } } : { body: { text }, alertId };
}
