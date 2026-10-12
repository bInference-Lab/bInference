import { z } from "zod";
import type { RuntimeSearch } from "../control/runtime-settings.schema.js";
import type { ToolOutcome } from "../loop/turn-records.js";
import { type ApiParts, callApi } from "./api-call.js";
import { htmlText } from "./page-text.js";
import {
  failedCall,
  outsideAnswer,
  plainAnswer,
  refusalAnswer,
  statusAnswer,
  unreadableAnswer,
  type WebProvider,
} from "./web-answers.js";

/** One web search result. */
interface WebHit {
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
  /** When the page was published or changed, as the provider gives it, when it does. */
  readonly age: string | undefined;
}

/** A search `search_web` runs: the query and how many results it asks for. */
export interface WebSearchTerms {
  readonly query: string;
  readonly count: number;
}

const braveUrl = "https://api.search.brave.com/res/v1/web/search";
const tavilyUrl = "https://api.tavily.com/search";

// Brave Search's documented answer, the fields read here (`GET /res/v1/web/search`).
const braveAnswerSchema = z.object({
  web: z
    .object({
      results: z.array(
        z.object({
          title: z.string(),
          url: z.string(),
          description: z.string().optional(),
          age: z.string().optional(),
        }),
      ),
    })
    .optional(),
});

// Tavily's documented answer, the fields read here (`POST /search`).
const tavilyAnswerSchema = z.object({
  results: z.array(
    z.object({
      title: z.string(),
      url: z.string(),
      content: z.string(),
      published_date: z.string().nullish(),
    }),
  ),
});

// Brave marks the query's words in its descriptions with HTML.
function plain(text: string): string {
  return htmlText(text).text.replaceAll("\n", " ");
}

function hitLines(provider: WebProvider, hits: readonly WebHit[]): ToolOutcome {
  if (hits.length === 0) {
    return plainAnswer(`${provider} found nothing for this query.`);
  }
  const lines = hits.flatMap((hit, index) => [
    `${String(index + 1)}. ${hit.title}${hit.age === undefined ? "" : ` (${hit.age})`}`,
    `   ${hit.url}`,
    `   ${hit.snippet}`,
  ]);
  return outsideAnswer(`web search results from ${provider}`, lines);
}

// The seconds until the window that ran out resets: Brave lists one value per window, such as
// "1, 15000" for a second and a month, with the reset of each in seconds.
function braveWaitSec(headers: Readonly<Record<string, string>>): number | undefined {
  const numbers = (name: string): readonly number[] =>
    (headers[name] ?? "").split(",").map((part) => Number(part.trim()));
  const remaining = numbers("x-ratelimit-remaining");
  const waits = numbers("x-ratelimit-reset").filter(
    (wait, index) => Number.isFinite(wait) && remaining[index] === 0,
  );
  return waits.length === 0 ? undefined : Math.max(...waits);
}

async function searchBrave(
  terms: WebSearchTerms,
  key: string,
  call: { readonly parts: ApiParts; readonly signal: AbortSignal },
): Promise<ToolOutcome> {
  const query = new URLSearchParams({ q: terms.query, count: String(terms.count) });
  const headers = { accept: "application/json", "x-subscription-token": key };
  const request = { method: "GET", url: `${braveUrl}?${query.toString()}`, headers } as const;
  const answer = await callApi(request, call.parts, call.signal);
  if (answer.kind === "failed") {
    return failedCall("Brave Search", answer.failure);
  }
  if (answer.status < 200 || answer.status >= 300) {
    const waitSec = braveWaitSec(answer.headers);
    const meaning = {
      provider: "Brave Search" as const,
      status: answer.status,
      keyName: "search.keys.brave",
    };
    return statusAnswer(waitSec === undefined ? meaning : { ...meaning, waitSec });
  }
  const parsed = braveAnswerSchema.safeParse(answer.json);
  if (!parsed.success) {
    return unreadableAnswer("Brave Search");
  }
  const hits = (parsed.data.web?.results ?? []).slice(0, terms.count).map((result) => ({
    title: plain(result.title),
    url: result.url,
    snippet: plain(result.description ?? ""),
    age: result.age,
  }));
  return hitLines("Brave Search", hits);
}

async function searchTavily(
  terms: WebSearchTerms,
  key: string,
  call: { readonly parts: ApiParts; readonly signal: AbortSignal },
): Promise<ToolOutcome> {
  const body = JSON.stringify({
    query: terms.query,
    max_results: terms.count,
    search_depth: "basic",
    topic: "general",
    include_answer: false,
    include_raw_content: false,
    include_images: false,
  });
  const headers = { authorization: `Bearer ${key}`, "content-type": "application/json" };
  const answer = await callApi(
    { method: "POST", url: tavilyUrl, headers, body },
    call.parts,
    call.signal,
  );
  if (answer.kind === "failed") {
    return failedCall("Tavily", answer.failure);
  }
  if (answer.status < 200 || answer.status >= 300) {
    const waitSec = Number(answer.headers["retry-after"]);
    const meaning = {
      provider: "Tavily" as const,
      status: answer.status,
      keyName: "search.keys.tavily",
    };
    return statusAnswer(Number.isFinite(waitSec) ? { ...meaning, waitSec } : meaning);
  }
  const parsed = tavilyAnswerSchema.safeParse(answer.json);
  if (!parsed.success) {
    return unreadableAnswer("Tavily");
  }
  const hits = parsed.data.results.slice(0, terms.count).map((result) => ({
    title: result.title,
    url: result.url,
    snippet: result.content.replaceAll("\n", " "),
    age: result.published_date ?? undefined,
  }));
  return hitLines("Tavily", hits);
}

/** The provider `search_web` uses and its key: the owner's pick, else the first with a key. */
function providerOf(
  search: RuntimeSearch,
): { readonly provider: "brave" | "tavily"; readonly key: string } | undefined {
  const order = search.provider === undefined ? (["brave", "tavily"] as const) : [search.provider];
  for (const provider of order) {
    const key = search.keys[provider];
    if (key !== undefined) {
      return { provider, key };
    }
  }
  return undefined;
}

const noProvider =
  "No search provider is configured, so search_web cannot search. Tell the owner that a Brave Search key (search.keys.brave) or a Tavily key (search.keys.tavily) in the config turns it on.";

/**
 * Searches the web for `search_web` (decision 0205): with Brave Search or Tavily, the owner's pick
 * or else the first with a key, and with neither, an answer that no search provider is
 * configured. Results are outside content; a provider's refusal or failure is told in
 * binference's own words and is not.
 */
export async function searchWeb(
  terms: WebSearchTerms,
  search: RuntimeSearch,
  call: { readonly parts: ApiParts; readonly signal: AbortSignal },
): Promise<ToolOutcome> {
  const chosen = providerOf(search);
  if (chosen === undefined) {
    return refusalAnswer(noProvider);
  }
  return chosen.provider === "brave"
    ? searchBrave(terms, chosen.key, call)
    : searchTavily(terms, chosen.key, call);
}
