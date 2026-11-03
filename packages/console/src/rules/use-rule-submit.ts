import type { ProtocolClient } from "@binference/client";
import { displayOutsideText } from "@binference/i18n";
import { type AgentView, operations, type ResultOf } from "@binference/protocol";
import { type UseMutationResult, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEngine } from "../connection/engine-context";
import {
  type FoundAsset,
  type FoundAssets,
  type RuleFields,
  type RuleProblem,
  ruleRequestOf,
} from "./rule-request";

/** What the form asks for: the agent, the fields, and the token and spend as typed. */
export interface RuleSubmit {
  readonly agent: AgentView;
  readonly fields: RuleFields;
  readonly token: string;
  readonly spend: string;
}

/** What came of a submit: the rule with its URL shown once, or what the form must say. */
export type SubmitOutcome =
  | { readonly kind: "created"; readonly created: ResultOf<"webhookRule/create"> }
  | { readonly kind: "problem"; readonly problem: RuleProblem }
  | { readonly kind: "token"; readonly token: string; readonly matches: string }
  | { readonly kind: "noWallet" };

// A symbol is set by whoever deployed the token, so it is cut and made visible.
const symbolLength = 16;
const callMs = 30_000;

// A chain's reference as an account names it: `eip155:56` of `eip155:56:0x…`.
function chainOf(account: string): string {
  return account.split(":").slice(0, 2).join(":");
}

type Found = { readonly ok: true; readonly asset: FoundAsset } | SubmitOutcome;

// The one token a query names on the chain: the registry's, or an address it does not list.
async function found(
  client: ProtocolClient,
  search: { readonly chain: string; readonly agent: AgentView; readonly query: string },
): Promise<Found> {
  const args = operations["asset/search"].args.parse({
    chain: search.chain,
    query: search.query.trim(),
    agent: search.agent.agent,
  });
  const page = await client.call("asset/search", args, { signal: AbortSignal.timeout(callMs) });
  const [only] = page.items;
  const [unlisted] = page.unlisted ?? [];
  if (page.items.length === 1 && only !== undefined) {
    return { ok: true, asset: { asset: only.asset, decimals: only.decimals } };
  }
  if (page.items.length === 0 && unlisted !== undefined) {
    return { ok: true, asset: { asset: unlisted.asset } };
  }
  const matches = page.items.map(({ symbol }) => displayOutsideText(symbol, symbolLength));
  return { kind: "token", token: search.query.trim(), matches: matches.join(", ") };
}

async function assetsOf(
  client: ProtocolClient,
  submit: RuleSubmit,
): Promise<FoundAssets | SubmitOutcome> {
  const wallet = submit.agent.defaultWallet;
  if (wallet === undefined) {
    return { kind: "noWallet" };
  }
  const chain = chainOf(wallet.address);
  const token = await found(client, { chain, agent: submit.agent, query: submit.token });
  if (!("ok" in token)) {
    return token;
  }
  if (submit.fields.side === "sell") {
    return { token: token.asset, counted: token.asset };
  }
  if (submit.spend.trim() === "") {
    return { token: token.asset };
  }
  const spend = await found(client, { chain, agent: submit.agent, query: submit.spend });
  return "ok" in spend ? { token: token.asset, spend: spend.asset, counted: spend.asset } : spend;
}

/**
 * Makes a rule from the form: finds its token and what a buy spends with `asset/search` on the
 * chain of the agent's default wallet, builds the request, and asks `webhookRule/create`, which
 * answers the URL once. Nothing is stored when a field cannot be read or a token not found.
 */
export function useRuleSubmit(): UseMutationResult<SubmitOutcome, Error, RuleSubmit> {
  const { client } = useEngine();
  const queries = useQueryClient();
  return useMutation({
    mutationFn: async (submit): Promise<SubmitOutcome> => {
      const assets = await assetsOf(client, submit);
      if ("kind" in assets) {
        return assets;
      }
      const context = { agent: submit.agent.agent, found: assets, nowMs: Date.now() };
      const made = ruleRequestOf(submit.fields, context);
      if (!made.ok) {
        return { kind: "problem", problem: made.problem };
      }
      const signal = AbortSignal.timeout(callMs);
      const created = await client.call("webhookRule/create", made.request, { signal });
      return { kind: "created", created };
    },
    onSettled: async () => {
      await queries.invalidateQueries({ queryKey: ["webhookRules"] });
      await queries.invalidateQueries({ queryKey: ["intents"] });
    },
  });
}
