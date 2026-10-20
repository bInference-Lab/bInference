import type { JsonValue } from "@binference/core";
import { isObject } from "../config/shown-config.js";
import { redactReportText, type ReportPlaces, urlOrigin } from "./report-text.js";

/** What stands in for a local path, which names the owner's folders. */
export const pathMark = "[path]";

const urlStart = /^[a-z][a-z0-9+.-]*:\/\//i;
// An absolute path on macOS, Linux or Windows, or one under the home folder.
const pathStart = /^(?:\/|~[/\\]|[A-Za-z]:[/\\]|\\\\)/;

function valueText(text: string, places: ReportPlaces): string {
  if (urlStart.test(text)) {
    return urlOrigin(text);
  }
  return pathStart.test(text) ? pathMark : redactReportText(text, places);
}

/**
 * A JSON value as the support bundle may hold it: each string that is a URL cut to its origin,
 * each local path replaced by `[path]`, and every other string and every key passed through
 * {@link redactReportText}. Numbers, booleans and nulls stay as they are.
 */
export function redactReportJson(value: JsonValue, places: ReportPlaces): JsonValue {
  if (typeof value === "string") {
    return valueText(value, places);
  }
  if (Array.isArray(value)) {
    const items: readonly JsonValue[] = value;
    return items.map((item) => redactReportJson(item, places));
  }
  if (isObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        redactReportText(key, places),
        redactReportJson(child, places),
      ]),
    );
  }
  return value;
}
