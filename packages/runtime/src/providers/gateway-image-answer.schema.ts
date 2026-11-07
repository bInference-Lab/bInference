import { z } from "zod";

/** The images the gateway's image endpoint sent back, as bytes, or why none came. */
export interface GatewayImages {
  readonly images: readonly Uint8Array[];
  /**
   * The error the gateway sent inside a successful answer, as it does when the model behind it
   * failed: its code and words, cut short.
   */
  readonly error?: string;
  readonly usage?: { readonly inputTokens: number; readonly outputTokens: number };
  /**
   * How the answer was laid out, its fields and counts and never its words, for the line that says
   * why no image came: such as `fields created,data; data 1 (bad base64)`.
   */
  readonly shape: string;
}

const record = z.record(z.string(), z.unknown());
const usageSchema = z.looseObject({
  input_tokens: z.number().nullish(),
  output_tokens: z.number().nullish(),
  prompt_tokens: z.number().nullish(),
  completion_tokens: z.number().nullish(),
});

/** One image's bytes, or why an entry held none, in a few words. */
type Found = { readonly bytes: Uint8Array } | { readonly missed: string };

function base64Bytes(text: string): Uint8Array | undefined {
  const canonical = text.replaceAll(/\s+/gu, "").replaceAll("-", "+").replaceAll("_", "/");
  if (canonical === "" || !/^[A-Za-z0-9+/]+=*$/u.test(canonical)) {
    return undefined;
  }
  const bytes = Buffer.from(canonical, "base64");
  return bytes.byteLength === 0 ? undefined : new Uint8Array(bytes);
}

// One `data` entry: its `b64_json`; a link is never fetched, as binference asks for base64.
function fromEntry(value: unknown): Found {
  const entry = record.safeParse(value);
  if (!entry.success) {
    return { missed: "not an object" };
  }
  const text = entry.data["b64_json"];
  if (typeof text === "string") {
    const bytes = base64Bytes(text);
    return bytes === undefined ? { missed: "bad base64" } : { bytes };
  }
  if (typeof entry.data["url"] === "string") {
    return { missed: "a link, never fetched" };
  }
  return { missed: `fields ${Object.keys(entry.data).join(",") || "none"}` };
}

// Words on one line, cut to `room` characters; nothing for a value that is not text.
function oneLine(value: unknown, room: number): string {
  return typeof value === "string" ? value.replaceAll(/\s+/gu, " ").trim().slice(0, room) : "";
}

// The model's own provider and words the gateway adds to its error, as `metadata`.
function causeOf(metadata: unknown): string {
  const read = record.safeParse(metadata);
  if (!read.success) {
    return "";
  }
  const provider = oneLine(read.data["provider_name"], 40);
  const raw = oneLine(read.data["raw"], 300);
  const from = provider === "" ? "" : ` from ${provider}`;
  return raw === "" && from === "" ? "" : `;${from}${raw === "" ? "" : `: ${raw}`}`;
}

// The error sent with a 200, `{ error: { code, message, metadata } }`, in a short line.
function errorOf(top: Readonly<Record<string, unknown>>): string | undefined {
  const error = record.safeParse(top["error"]);
  if (!error.success) {
    return typeof top["error"] === "string" ? top["error"].slice(0, 300) : undefined;
  }
  const { code, message, metadata } = error.data;
  const coded =
    typeof code === "string" || typeof code === "number" ? ` (code ${String(code)})` : "";
  return `${oneLine(message, 300) || "no message"}${coded}${causeOf(metadata)}`;
}

function usageOf(value: unknown): GatewayImages["usage"] | undefined {
  const usage = usageSchema.safeParse(value);
  if (!usage.success) {
    return undefined;
  }
  const { data } = usage;
  const inputTokens = data.input_tokens ?? data.prompt_tokens ?? 0;
  const outputTokens = data.output_tokens ?? data.completion_tokens ?? 0;
  return inputTokens + outputTokens === 0 ? undefined : { inputTokens, outputTokens };
}

/**
 * The images of a `POST /images` answer (decision 0398): each `data` entry's `b64_json`, its token
 * counts when it gives them, and the error the gateway sends with a success. A link is never
 * fetched. When no image reads, `shape` gives the answer's fields and counts, never its words.
 */
export function gatewayImagesOf(answer: unknown): GatewayImages {
  const top = record.safeParse(answer);
  if (!top.success) {
    return { images: [], shape: `an answer that is not an object (${typeof answer})` };
  }
  const entries = Array.isArray(top.data["data"]) ? top.data["data"] : [];
  const found = entries.map(fromEntry);
  const images = found.flatMap((item) => ("bytes" in item ? [item.bytes] : []));
  const missed = [...new Set(found.flatMap((item) => ("missed" in item ? [item.missed] : [])))];
  const fields = Object.keys(top.data).join(",") || "none";
  const notes = missed.length === 0 ? "" : ` (${missed.join("; ")})`;
  const shape = `fields ${fields}; data ${String(entries.length)}${notes}`;
  const usage = usageOf(top.data["usage"]);
  const error = errorOf(top.data);
  return {
    images,
    shape,
    ...(usage === undefined ? {} : { usage }),
    ...(error === undefined ? {} : { error }),
  };
}
