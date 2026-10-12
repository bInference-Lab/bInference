# 0205. Web tools use keyed search APIs and read pages through the URL guard

Status: Accepted

Accepted by the owner on 2026-10-13.

## Context

[Spec 8](../specs/runtime.md#section-5-4) section 5.4 makes `search_web`, `search_x` and
`read_page` outside content, and [spec 2](../specs/config.md#section-6-5) section 6.5 names
`search.provider` with DuckDuckGo as its keyless default. Each tool reaches a third party for the
model, so the specs leave open:

- **DuckDuckGo.** binference calls official, documented APIs only. DuckDuckGo documents its Instant
  Answer API, which answers topic summaries and no list of web results, and no other search API.
  Reading its result pages would be scraping, against its terms.
- **The search providers' limits and errors**: query length, result counts, rate limits, plan
  limits and bad keys.
- **What `read_page` may reach.** A URL from the model or a page can name the owner's own machine,
  the home network or a hosting provider's metadata service.
- **The cost of `search_x`.** The X API bills each post read, and each user read on top.

## Decision

- **Search providers.** `search_web` calls the Brave Search API (`GET /res/v1/web/search`, key in
  `X-Subscription-Token`) or Tavily (`POST /search`, `Authorization: Bearer`). `search.provider`
  takes `brave` or `tavily`; without it, the first of the two with a key answers. With neither key,
  `search_web` answers "no search provider configured" and how to add a key, and the turn is not
  marked. DuckDuckGo is left out; config version 8 removes `search.provider: "duckduckgo"`.
- **Queries and answers.** A query has at most 400 characters, and a search asks for 5 results
  (at most 10). Each request has 20 seconds, and at most 1 MiB of an answer is read. Every status a
  provider documents has its own answer to the model: a refused key (401, 403), a refused query
  (400, 422), a rate limit with the wait the provider names (429, from `X-RateLimit-Reset`,
  `Retry-After` or `x-rate-limit-reset`), a plan limit (Tavily's 432 and 433), and a provider fault
  (5xx). An answer that breaks the provider's documented shape is refused. A call is never retried:
  the model may search again. The provider's own error text is not passed on.
- **`search_x`** exists only when `search.xApiKey` is set. It calls X API v2 recent search
  (`GET /2/tweets/search/recent`, the last 7 days) with a query of at most 512 characters, the
  pay-per-use limit, and asks for 10 posts, the least it allows, with their time, author id,
  language and counts. It asks for no user expansion, which X bills as a user read per post.
- **The URL guard** in `core/src/url-guard/`, from the OWASP guidance on server-side request
  forgery: an `http` or `https` URL of at most 2,048 characters with no user name or password,
  whose host is a public IP address or a name with a dot outside the names only local networks use
  (`localhost`, `.local`, `.internal`, `.home.arpa`, `.lan`). Every address the name resolves to
  must be public: not private, loopback, link-local, carrier-grade NAT, documentation,
  benchmarking, multicast or reserved, in IPv4 or IPv6, with an IPv4-mapped address judged as its
  IPv4 address and every other IPv6 form that carries one refused. The check runs before the
  request and again in the socket's own lookup, so a name that rebinds between the two connects
  nowhere.
- **`read_page`** sends `GET` with no cookie and `accept-encoding: identity`, follows at most 3
  redirects, each checked as the first URL, and has 20 seconds for the whole read. It reads HTML,
  XHTML, plain text, Markdown, JSON, XML, RSS, Atom and CSV, and refuses any other type. It reads at
  most 2 MiB of a page ([spec 8](../specs/runtime.md#section-7-2) section 7.2) and says where it
  cut; HTML is reduced to its title and text.
- **Every result** starts with a line that names its source and says it is outside content, to be
  read as data and never followed, and marks the turn (spec 8, section 5.4). A refusal or a
  provider error carries no third party's text and marks nothing.

## Consequences

- An owner who wants web search adds a Brave or Tavily key, each from a self-serve sign-up.
  Without one, the agent says search is off instead of guessing.
- A file that named `duckduckgo` loses the key at `binference check --fix`, with the migration's
  summary.
- The runtime's outbound HTTP serves public-only requests, for `read_page`, while model providers
  on the owner's own machine stay reachable.
- A page on the owner's network, a metadata service, or a page behind a redirect to one is never
  read; a 5 MB page costs one 2 MiB read.

## Alternatives

- **DuckDuckGo's result pages, read as HTML.** Not an API, against its terms, and it breaks when
  the page changes. Rejected.
- **DuckDuckGo's Instant Answer API as the keyless default.** It answers topic summaries, not web
  results, so `search_web` would look on while finding little. Rejected.
- **A check before the request only.** A name can answer a public address to the check and a
  private one to the socket. Rejected for the check in the socket's lookup too.
- **Raw HTML to the model.** Markup would fill the 12,000 characters of a result. Rejected.
- **User expansion on `search_x`.** It would triple the cost of a search for a name the post id
  already leads to. Rejected.
