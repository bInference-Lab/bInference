import { type JsonValue, jsonValueSchema } from "@binference/core";

const attachPrefix = "attach://";

// A multipart field as the Bot API reads it: a number, a JSON object or array, or text.
function fieldValue(text: string): JsonValue {
  if (/^-?\d+$/u.test(text)) {
    return Number(text);
  }
  if (text.startsWith("{") || text.startsWith("[")) {
    const parsed = jsonValueSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : text;
  }
  return text;
}

/** The prefix of a file field the fake read from an upload: the file's bytes in base64 follow. */
export const uploadPrefix = "upload:";

/**
 * Reads a Bot API request's body as Telegram does: JSON text as it is, or a `multipart/form-data`
 * upload, as grammY sends a file, into the same JSON, each `attach://<part>` field holding
 * {@link uploadPrefix} and the part's bytes in base64.
 */
export async function readFakeBody(init: RequestInit | undefined): Promise<string> {
  const body = init?.body ?? undefined;
  if (body === undefined || typeof body === "string") {
    return body ?? "{}";
  }
  const contentType = new Headers(init?.headers).get("content-type") ?? "";
  const form = await new Response(body, { headers: { "content-type": contentType } }).formData();
  const parts = [...form.entries()].flatMap(([name, value]) =>
    typeof value === "string" ? [] : [{ name, file: value }],
  );
  const read = await Promise.all(
    parts.map(async ({ name, file }) => {
      const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
      return [name, base64] as const;
    }),
  );
  const files = new Map(read);
  const fields = [...form.entries()].flatMap(([name, value]): [string, JsonValue][] => {
    if (typeof value !== "string") {
      return [];
    }
    const part = value.startsWith(attachPrefix)
      ? files.get(value.slice(attachPrefix.length))
      : undefined;
    return [[name, part === undefined ? fieldValue(value) : `${uploadPrefix}${part}`]];
  });
  return JSON.stringify(Object.fromEntries(fields));
}
