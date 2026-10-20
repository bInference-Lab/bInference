import type { JsonValue } from "@binference/core";
import { isObject } from "../config/shown-config.js";
import { redactReportText, type ReportPlaces, urlMark } from "./report-text.js";

/** What stands in for a local path, which names the owner's folders. */
export const pathMark = "[path]";

/** What a URL in the config is for, the one thing the bundle keeps of it. */
type UrlKind = "rpc" | "relay" | "public_address" | "model_provider" | "webhook";

const urlStart = /^[a-z][a-z0-9+.-]*:\/\//i;
// An absolute path on macOS, Linux or Windows, or one under the home folder.
const pathStart = /^(?:\/|~[/\\]|[A-Za-z]:[/\\]|\\\\)/;

// The kind of a URL by the config keys above it, such as `chains.rpc.<chain>.urls`.
function urlKindOf(path: readonly string[]): UrlKind | undefined {
  const keys = path.map((key) => key.toLowerCase());
  if (keys.some((key) => key.includes("webhook"))) {
    return "webhook";
  }
  if (keys.includes("rpc")) {
    return "rpc";
  }
  if (keys.includes("relays")) {
    return "relay";
  }
  if (keys.includes("publicurl") || keys.includes("extraorigins")) {
    return "public_address";
  }
  return keys.includes("providers") ? "model_provider" : undefined;
}

/** A URL as the bundle keeps it: `[url:<kind>]` when the keys above it say its kind, else `[url]`. */
function urlKindMark(path: readonly string[]): string {
  const kind = urlKindOf(path);
  return kind === undefined ? urlMark : `[url:${kind}]`;
}

function valueText(text: string, path: readonly string[], places: ReportPlaces): string {
  if (urlStart.test(text)) {
    return urlKindMark(path);
  }
  return pathStart.test(text) ? pathMark : redactReportText(text, places);
}

function redactAt(value: JsonValue, path: readonly string[], places: ReportPlaces): JsonValue {
  if (typeof value === "string") {
    return valueText(value, path, places);
  }
  if (Array.isArray(value)) {
    const items: readonly JsonValue[] = value;
    return items.map((item) => redactAt(item, path, places));
  }
  if (isObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        redactReportText(key, places),
        redactAt(child, [...path, key], places),
      ]),
    );
  }
  return value;
}

/**
 * A JSON value as the support bundle may hold it: each string that is a URL replaced by its kind
 * alone (`[url:rpc]`, `[url:relay]`, `[url:public_address]`, `[url:model_provider]`,
 * `[url:webhook]`, by the keys above it, else `[url]`), so no host, path or credential stays; each
 * local path replaced by `[path]`; and every other string and every key passed through
 * {@link redactReportText}. Numbers, booleans and nulls stay as they are.
 */
export function redactReportJson(value: JsonValue, places: ReportPlaces): JsonValue {
  return redactAt(value, [], places);
}
