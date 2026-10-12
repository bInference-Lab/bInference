import type { Clock } from "@binference/core";
import { z } from "zod";
import type { ToolOutcome } from "../loop/turn-records.js";
import { type ApiParts, callApi } from "./api-call.js";
import {
  failedCall,
  outsideAnswer,
  plainAnswer,
  statusAnswer,
  unreadableAnswer,
} from "./web-answers.js";

const recentSearchUrl = "https://api.x.com/2/tweets/search/recent";

/** The longest query X's recent search takes on its pay-per-use plan. */
export const maxXQueryChars = 512;

// X's least page: each post read is billed, so a search reads no more.
const postsPerSearch = 10;

// X API v2's documented answer of recent search, the fields asked for and read here.
const recentSearchSchema = z.object({
  data: z
    .array(
      z.object({
        id: z.string(),
        text: z.string(),
        author_id: z.string().optional(),
        created_at: z.string().optional(),
        lang: z.string().optional(),
        public_metrics: z
          .object({ like_count: z.number(), retweet_count: z.number(), reply_count: z.number() })
          .optional(),
      }),
    )
    .optional(),
});

type Post = NonNullable<z.infer<typeof recentSearchSchema>["data"]>[number];

function postLines(post: Post, index: number): readonly string[] {
  const facts = [
    `post ${post.id}`,
    ...(post.author_id === undefined ? [] : [`by author ${post.author_id}`]),
    ...(post.created_at === undefined ? [] : [post.created_at]),
    ...(post.lang === undefined ? [] : [`language ${post.lang}`]),
    ...(post.public_metrics === undefined
      ? []
      : [
          `${String(post.public_metrics.like_count)} likes`,
          `${String(post.public_metrics.retweet_count)} reposts`,
          `${String(post.public_metrics.reply_count)} replies`,
        ]),
  ];
  return [
    `${String(index + 1)}. ${facts.join(", ")}`,
    `   https://x.com/i/web/status/${post.id}`,
    `   ${post.text.replaceAll("\n", " ")}`,
  ];
}

// X names the end of its rate window as epoch seconds.
function waitSecOf(headers: Readonly<Record<string, string>>, clock: Clock): number | undefined {
  const resetAt = Number(headers["x-rate-limit-reset"]);
  return Number.isFinite(resetAt) && resetAt > 0 ? resetAt - clock.now() / 1000 : undefined;
}

/**
 * Searches the last 7 days of posts on X for `search_x` (decision 0205), through X API v2's
 * recent search with the owner's key: 10 posts with their time, author id, language and counts,
 * and no user expansion, which X bills on top. Posts are outside content; X's refusal or failure
 * is told in binference's own words and is not.
 */
export async function searchX(
  query: string,
  key: string,
  call: { readonly parts: ApiParts; readonly signal: AbortSignal },
): Promise<ToolOutcome> {
  const params = new URLSearchParams({
    query,
    max_results: String(postsPerSearch),
    "tweet.fields": "created_at,author_id,lang,public_metrics",
  });
  const request = {
    method: "GET",
    url: `${recentSearchUrl}?${params.toString()}`,
    headers: { authorization: `Bearer ${key}` },
  } as const;
  const answer = await callApi(request, call.parts, call.signal);
  if (answer.kind === "failed") {
    return failedCall("X", answer.failure);
  }
  if (answer.status < 200 || answer.status >= 300) {
    const waitSec = waitSecOf(answer.headers, call.parts.clock);
    const meaning = { provider: "X", status: answer.status, keyName: "search.xApiKey" } as const;
    return statusAnswer(waitSec === undefined ? meaning : { ...meaning, waitSec });
  }
  const parsed = recentSearchSchema.safeParse(answer.json);
  if (!parsed.success) {
    return unreadableAnswer("X");
  }
  const posts = parsed.data.data ?? [];
  return posts.length === 0
    ? plainAnswer("X found no post from the last 7 days for this query.")
    : outsideAnswer("posts on X from its recent search", posts.flatMap(postLines));
}
