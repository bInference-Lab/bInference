import { z } from "zod";

/** Where a video job stands, as the gateway says; `unknown` for any other word. */
type VideoJobStatus = "pending" | "in_progress" | "completed" | "failed" | "expired" | "unknown";

/** A video job, or the gateway's refusal of a call about one (decision 0405). */
export interface GatewayVideoJob {
  readonly id?: string;
  readonly status: VideoJobStatus;
  /** Where to fetch the file once it is done. */
  readonly urls: readonly string[];
  /** What the video was charged, in micro-dollars rounded up, once it is done. */
  readonly costMicros?: bigint;
  /** The gateway's code and words for why the job or the call failed, cut short. */
  readonly error?: string;
}

const statuses: ReadonlySet<string> = new Set([
  "pending",
  "in_progress",
  "completed",
  "failed",
  "expired",
]);

function isStatus(value: string): value is Exclude<VideoJobStatus, "unknown"> {
  return statuses.has(value);
}

const errorSchema = z.looseObject({
  code: z.string().optional().catch(undefined),
  message: z.string().optional().catch(undefined),
});

const jobSchema = z.looseObject({
  id: z.string().optional().catch(undefined),
  status: z.string().optional().catch(undefined),
  unsigned_urls: z.array(z.string()).catch([]),
  usage: z
    .looseObject({ cost: z.number().nonnegative().optional().catch(undefined) })
    .nullish()
    .catch(null),
  error: z.union([errorSchema, z.string()]).nullish().catch(null),
});

// The gateway's error, as `code: words`, cut to fit a line the agent reads.
function errorOf(
  error: z.infer<typeof errorSchema> | string | null | undefined,
): string | undefined {
  if (error === null || error === undefined) {
    return undefined;
  }
  const said =
    typeof error === "string" ? error : [error.code, error.message].filter(Boolean).join(": ");
  const words = said.replaceAll(/\s+/gu, " ").trim().slice(0, 300);
  return words === "" ? undefined : words;
}

// Dollars as the gateway writes them, in micro-dollars rounded up: from their decimal digits, so
// no floating error moves a charge.
function microsOf(dollars: number): bigint {
  const digits = /^(\d+)(?:\.(\d+))?$/u.exec(String(dollars));
  if (digits === null) {
    // Written with an exponent: under a micro-dollar, or too large to be a video's charge.
    return dollars > 0 ? 1n : 0n;
  }
  const fraction = digits[2] ?? "";
  const kept = BigInt(digits[1] ?? "0") * 1_000_000n + BigInt(fraction.slice(0, 6).padEnd(6, "0"));
  return /[1-9]/u.test(fraction.slice(6)) ? kept + 1n : kept;
}

/** The JSON a text holds, or null for text that is no JSON, such as an error page. */
export function jsonOfText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Reads the gateway's answer about a video job: its id, where it stands, the links to its file,
 * its charge and its error, each part that does not read left out.
 */
export function gatewayVideoJobOf(answer: unknown): GatewayVideoJob {
  const read = jobSchema.safeParse(answer);
  if (!read.success) {
    return { status: "unknown", urls: [] };
  }
  const { id, status, unsigned_urls: urls, usage, error } = read.data;
  const said = errorOf(error);
  const cost = usage?.cost;
  return {
    ...(id === undefined ? {} : { id }),
    status: status !== undefined && isStatus(status) ? status : "unknown",
    urls,
    ...(cost === undefined ? {} : { costMicros: microsOf(cost) }),
    ...(said === undefined ? {} : { error: said }),
  };
}
