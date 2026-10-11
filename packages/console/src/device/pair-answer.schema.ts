import * as z from "zod/mini";
import type { PairOutcome, PairRefusal } from "./pair-device";

const pairedSchema = z.object({ deviceId: z.string().check(z.regex(/^dev_/)) });
const refusedSchema = z.object({ error: z.object({ code: z.string() }) });

function refusalOf(code: string | undefined): PairRefusal {
  if (code === "auth.invalid") {
    return "used";
  }
  return code === "auth.expired" ? "expired" : "refused";
}

/** Text as JSON, or `undefined` for text that is not JSON. */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Reads the engine's answer to `POST /pair`: a 201 with the device id, or a refusal whose code says
 * the link was used (`auth.invalid`) or expired (`auth.expired`). Anything else is `refused`.
 */
export function readPairAnswer(status: number, body: unknown): PairOutcome {
  if (status === 201) {
    const paired = pairedSchema.safeParse(body);
    return paired.success
      ? { ok: true, deviceId: paired.data.deviceId }
      : { ok: false, refusal: "refused" };
  }
  const refused = refusedSchema.safeParse(body);
  return { ok: false, refusal: refusalOf(refused.success ? refused.data.error.code : undefined) };
}
