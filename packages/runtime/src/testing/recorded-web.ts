import type { HostLookup } from "@binference/core";
import type { RecordedAnswer } from "./recorded-http.js";

// Answers of the web tools' providers as their documentation shows them, and a resolver for the
// names the tests use. No test reaches the network.

const json = { "content-type": "application/json" };

/** A Brave Search web search answer, in the shape of its API reference's example. */
export const braveAnswer: RecordedAnswer = {
  status: 200,
  headers: json,
  chunks: [
    JSON.stringify({
      type: "search",
      query: { original: "pancakeswap fees", more_results_available: true },
      web: {
        type: "search",
        results: [
          {
            title: "Fees | <strong>PancakeSwap</strong> Docs",
            url: "https://docs.pancakeswap.finance/trade/fees",
            description:
              "Each <strong>swap</strong> pays a fee &amp; part goes to liquidity providers.",
            age: "2 days ago",
            language: "en",
            family_friendly: true,
          },
        ],
      },
    }),
  ],
};

/** A Tavily search answer, in the shape of its API reference's example. */
export const tavilyAnswer: RecordedAnswer = {
  status: 200,
  headers: json,
  chunks: [
    JSON.stringify({
      query: "pancakeswap fees",
      answer: null,
      images: [],
      results: [
        {
          title: "Fees | PancakeSwap Docs",
          url: "https://docs.pancakeswap.finance/trade/fees",
          content: "Each swap pays a fee [...] part goes to liquidity providers.",
          score: 0.81,
          raw_content: null,
          favicon: "https://docs.pancakeswap.finance/favicon.ico",
        },
      ],
      response_time: "1.67",
      request_id: "123e4567-e89b-12d3-a456-426614174111",
    }),
  ],
};

/** An X API v2 recent search answer, in the shape of its quickstart's example. */
export const xRecentAnswer: RecordedAnswer = {
  status: 200,
  headers: json,
  chunks: [
    JSON.stringify({
      data: [
        {
          id: "1234567890123456789",
          text: "Started learning Python and loving it!",
          created_at: "2024-01-15T10:30:00.000Z",
          author_id: "9876543210",
          lang: "en",
          public_metrics: { retweet_count: 5, reply_count: 2, like_count: 42, quote_count: 1 },
          edit_history_tweet_ids: ["1234567890123456789"],
        },
      ],
      meta: { newest_id: "1234567890123456789", oldest_id: "1234567890123456789", result_count: 1 },
    }),
  ],
};

/** A small HTML page, as a server answers it. */
export function htmlAnswer(
  body: string,
  headers: Readonly<Record<string, string>> = {},
): RecordedAnswer {
  const answer: RecordedAnswer = {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", ...headers },
    chunks: [body],
  };
  return answer;
}

/** A redirect to `location`. */
export function redirectTo(location: string, status = 302): RecordedAnswer {
  return { status, headers: { location }, chunks: [] };
}

/**
 * A resolver for the tests' names: `*.example.com` and `example.org` resolve to a public address,
 * names with `private` in them to a private one, and every other name not at all.
 */
export const testLookup: HostLookup = (hostname, _options, callback) => {
  if (hostname.includes("private")) {
    callback(null, [{ address: "192.168.1.20", family: 4 }]);
  } else if (hostname.endsWith("example.com") || hostname === "example.org") {
    callback(null, [{ address: "93.184.215.14", family: 4 }]);
  } else {
    callback(Object.assign(new Error("not found"), { code: "ENOTFOUND" }), []);
  }
};
