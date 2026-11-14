import type { FakeAnswers } from "./fake-client";

// What a plugins screen test's engine answers (decisions 0348 and 0433): one plugin on with npm
// provenance, one stopped after crashing without provenance, one whose files changed, and one
// held on a composition that needs listings.

const hash = "a".repeat(64);
const addedAt = Date.UTC(2026, 10, 3, 9, 30);

const fearIndex = "plg_0190f1c2-3a4b-7c5d-8e6f-000000000001";
const whaleFeed = "plg_0190f1c2-3a4b-7c5d-8e6f-000000000002";
const echoFeed = "plg_0190f1c2-3a4b-7c5d-8e6f-000000000003";
const chainNews = "plg_0190f1c2-3a4b-7c5d-8e6f-000000000004";

function viewOf(plugin: string, name: string, extra: object): object {
  return {
    plugin,
    name,
    version: "1.2.0",
    tier: "community",
    source: `npm:${name}@1.2.0`,
    hash,
    permissions: ["kind:data"],
    state: "enabled",
    installedAt: addedAt,
    provenance: "none",
    ...extra,
  };
}

const on = viewOf(fearIndex, "fear-index", {
  permissions: ["kind:data", "host:api.alternative.me", "tool:fear_index", "config:window"],
  provenance: "verified",
  publisher: "github.com/owner/fear-index",
  tools: ["fear_index__fear_index"],
});
const whaleFields = {
  permissions: ["kind:data", "host:api.whales.example", "host:ws.whales.example"],
  publisher: "whaler",
};
const crashed = viewOf(whaleFeed, "whale-feed", {
  ...whaleFields,
  state: "disabled",
  disabledReason: "crashes",
});
const changed = viewOf(echoFeed, "echo-feed", { state: "disabled", disabledReason: "changed" });
const held = viewOf(chainNews, "chain-news", {
  listing: { listing: "pls_0190f1c2-3a4b-7c5d-8e6f-000000000001", version: 2, state: "held" },
});

/** The ids a plugins test names. */
export const pluginsFixture = { fearIndex, whaleFeed, echoFeed, chainNews } as const;

/** The fake engine's answers for the plugins screen: a disable answers it off, an enable on. */
export const pluginsAnswers: FakeAnswers = {
  "plugin/list": () => ({ items: [on, crashed, changed, held] }),
  "plugin/disable": () => ({ ...on, state: "disabled", disabledReason: "owner" }),
  "plugin/enable": () => viewOf(whaleFeed, "whale-feed", whaleFields),
};
