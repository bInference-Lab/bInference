import {
  type AssetSearchTerms,
  assetSearchTermsSchema,
  bridgeQuoteTermsSchema,
  type OrderState,
  operations,
  orderStateSchema,
  stakingOptionsTermsSchema,
  type SwapTerms,
  swapTermsSchema,
} from "@binference/protocol";
import { z } from "zod";
import type { ToolOutcome } from "../loop/turn-records.js";
import { agentToolTexts } from "./agent-tool-texts.js";
import { type AgentTool, defineTool } from "./define-tool.js";
import { intentsTool } from "./intents-tool.js";
import { answerOrFailure, answerOrRefusal, jsonOf, withUnlistedHidden } from "./tool-answer.js";
import type { AgentToolParts } from "./tool-client.js";
import { walletsTool } from "./wallets-tool.js";

// The agent's read tools (runtime spec, section 5.1). Each maps onto one read operation, named for
// the agent of its turn, and answers the engine's JSON. Every read may run beside the others.

const ops = operations;

function answer(text: string): ToolOutcome {
  return { text, isError: false };
}

// The registry's tokens carry the registry's words; a match the registry does not vouch for is
// outside content, as token_info of it is.
function tokenSearchTool({ agent, client }: AgentToolParts): AgentTool {
  return defineTool<AssetSearchTerms>({
    name: "token_search",
    kind: "read",
    parallel: true,
    addressSource: "engine",
    description: agentToolTexts.token_search,
    args: assetSearchTermsSchema,
    run: async (args, { signal }) =>
      answerOrFailure("token_search", async () => {
        const view = await client.call("asset/search", { ...args, agent }, { signal });
        const text = jsonOf(ops["asset/search"].result, view);
        const isVouched = view.items.every((item) => item.verified);
        return isVouched ? answer(text) : { ...answer(text), outside: true };
      }),
  });
}

function portfolioTool({ agent, client }: AgentToolParts): AgentTool {
  return defineTool({
    name: "portfolio",
    kind: "read",
    parallel: true,
    addressSource: "engine",
    description: agentToolTexts.portfolio,
    args: z.strictObject({}),
    run: async (_args, { signal }) =>
      answerOrFailure("portfolio", async () => {
        const view = await client.call("portfolio/get", { agent }, { signal });
        const shown = { ...view, assets: withUnlistedHidden(view.assets) };
        return answer(jsonOf(ops["portfolio/get"].result, shown));
      }),
  });
}

// An unlisted token's name and symbol are its deployer's words: this result alone shows them, and
// it is outside content (runtime spec, section 5.4).
function tokenInfoTool({ client }: AgentToolParts): AgentTool {
  return defineTool({
    name: "token_info",
    kind: "read",
    parallel: true,
    addressSource: "engine",
    description: agentToolTexts.token_info,
    args: ops["asset/get"].args,
    run: async (args, { signal }) =>
      answerOrFailure("token_info", async () => {
        const view = await client.call("asset/get", args, { signal });
        const text = jsonOf(ops["asset/get"].result, view);
        return view.verified ? answer(text) : { ...answer(text), outside: true };
      }),
  });
}

function tokenRiskTool({ agent, client }: AgentToolParts): AgentTool {
  return defineTool({
    name: "token_risk",
    kind: "read",
    parallel: true,
    addressSource: "engine",
    description: agentToolTexts.token_risk,
    args: ops["asset/get"].args,
    run: async (args, { signal }) =>
      answerOrFailure("token_risk", async () => {
        const view = await client.call("risk/check", { ...args, agent }, { signal });
        return answer(jsonOf(ops["risk/check"].result, view));
      }),
  });
}

function quoteTool({ agent, client }: AgentToolParts): AgentTool {
  return defineTool<SwapTerms>({
    name: "quote",
    kind: "read",
    parallel: true,
    addressSource: "engine",
    description: agentToolTexts.quote,
    args: swapTermsSchema,
    run: async (terms, { signal }) =>
      answerOrFailure("quote", async () => {
        const view = await client.call("quote/get", { ...terms, agent, kind: "swap" }, { signal });
        return answer(jsonOf(ops["quote/get"].result, view));
      }),
  });
}

// A bridge quote's refusals the agent can act on, by code.
const bridgeQuoteRefusals: Readonly<Record<string, string>> = {
  "address.no_recipient":
    "bridge_quote names no recipient, and the rescue address cannot be paid on that chain. Ask the owner which saved address there to use, then quote again with to.entry.",
};

/**
 * `bridge_quote`, a read tool (runtime spec, section 5.1): each bridge route for moving an amount
 * to another chain through `bridge/quote`, the best least output first, proposing nothing. The
 * engine prices it, so it marks nothing.
 */
function bridgeQuoteTool({ agent, client }: AgentToolParts): AgentTool {
  return defineTool({
    name: "bridge_quote",
    kind: "read",
    parallel: true,
    addressSource: "engine",
    description: agentToolTexts.bridge_quote,
    args: bridgeQuoteTermsSchema,
    run: async (terms, { signal }) =>
      answerOrRefusal({ tool: "bridge_quote", refusals: bridgeQuoteRefusals }, async () => {
        const view = await client.call("bridge/quote", { ...terms, agent }, { signal });
        return answer(jsonOf(ops["bridge/quote"].result, view));
      }),
  });
}

/**
 * `staking_options`, a read tool (runtime spec, section 5.1): the validators each staking venue
 * lists through `staking/options`, and this agent's stakes. A validator's name is its operator's
 * own words, so an answer that lists a validator is outside content (runtime spec, section 5.4).
 */
function stakingOptionsTool({ agent, client }: AgentToolParts): AgentTool {
  return defineTool({
    name: "staking_options",
    kind: "read",
    parallel: true,
    addressSource: "engine",
    description: agentToolTexts.staking_options,
    args: stakingOptionsTermsSchema,
    run: async (terms, { signal }) =>
      answerOrFailure("staking_options", async () => {
        const view = await client.call("staking/options", { ...terms, agent }, { signal });
        const shown = { ...view, assets: withUnlistedHidden(view.assets) };
        const text = jsonOf(ops["staking/options"].result, shown);
        return view.items.length === 0 ? answer(text) : { ...answer(text), outside: true };
      }),
  });
}

/**
 * `addresses`, a read tool (runtime spec, section 5.1): the agent's address book through
 * `address/list`, so a send or a bridge can name an entry by its id. The owner saved each address
 * and wrote each label with the owner key, so the answer is a source of addresses, never outside
 * content.
 */
function addressesTool({ agent, client }: AgentToolParts): AgentTool {
  return defineTool({
    name: "addresses",
    kind: "read",
    parallel: true,
    addressSource: "engine",
    description: agentToolTexts.addresses,
    args: z.strictObject({}),
    run: async (_args, { signal }) =>
      answerOrFailure("addresses", async () => {
        const book = await client.call("address/list", { agent }, { signal });
        return answer(jsonOf(ops["address/list"].result, book));
      }),
  });
}

/** What `orders` takes: the state to filter by, and the cursor of the page after the first. */
interface OrdersArgs {
  readonly state?: OrderState;
  readonly cursor?: string;
}

const ordersArgs: z.ZodType<OrdersArgs> = z.strictObject({
  state: orderStateSchema.exactOptional(),
  cursor: z.string().min(1).max(512).exactOptional(),
});

function ordersTool({ agent, client }: AgentToolParts): AgentTool {
  return defineTool<OrdersArgs>({
    name: "orders",
    kind: "read",
    parallel: true,
    addressSource: "engine",
    description: agentToolTexts.orders,
    args: ordersArgs,
    run: async (args, { signal }) =>
      answerOrFailure("orders", async () => {
        const page = await client.call("order/list", { ...args, agent }, { signal });
        const shown =
          page.assets === undefined ? page : { ...page, assets: withUnlistedHidden(page.assets) };
        return answer(jsonOf(ops["order/list"].result, shown));
      }),
  });
}

// An intent of another agent is answered as one that does not exist: an agent reads its own.
function txStatusTool({ agent, client }: AgentToolParts): AgentTool {
  return defineTool({
    name: "tx_status",
    kind: "read",
    parallel: true,
    addressSource: "engine",
    description: agentToolTexts.tx_status,
    args: ops["intent/get"].args,
    run: async (args, { signal }) =>
      answerOrFailure("tx_status", async () => {
        const view = await client.call("intent/get", args, { signal });
        if (view.agent !== agent) {
          return { text: `This agent has no intent ${args.intent}.`, isError: true };
        }
        const shown = { ...view, assets: withUnlistedHidden(view.assets) };
        const text = jsonOf(ops["intent/get"].result, shown);
        // A staking move names its validator in the venue's own words (decision 0327).
        return view.kind === "stake" ? { ...answer(text), outside: true } : answer(text);
      }),
  });
}

/** The agent's read tools, in the order the model sees them. */
export function readTools(parts: AgentToolParts): readonly AgentTool[] {
  return [
    tokenSearchTool(parts),
    addressesTool(parts),
    walletsTool(parts),
    portfolioTool(parts),
    tokenInfoTool(parts),
    tokenRiskTool(parts),
    quoteTool(parts),
    bridgeQuoteTool(parts),
    stakingOptionsTool(parts),
    ordersTool(parts),
    txStatusTool(parts),
    intentsTool(parts),
  ];
}
