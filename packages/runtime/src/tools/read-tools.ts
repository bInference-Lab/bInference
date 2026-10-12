import {
  type AssetSearchTerms,
  assetSearchTermsSchema,
  type OrderState,
  operations,
  orderStateSchema,
  type SwapTerms,
  swapTermsSchema,
} from "@binference/protocol";
import { z } from "zod";
import type { ToolOutcome } from "../loop/turn-records.js";
import { agentToolTexts } from "./agent-tool-texts.js";
import { type AgentTool, defineTool } from "./define-tool.js";
import { answerOrFailure, jsonOf, withUnlistedHidden } from "./tool-answer.js";
import type { AgentToolParts } from "./tool-client.js";

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

function tokenRiskTool({ client }: AgentToolParts): AgentTool {
  return defineTool({
    name: "token_risk",
    kind: "read",
    parallel: true,
    addressSource: "engine",
    description: agentToolTexts.token_risk,
    args: ops["risk/check"].args,
    run: async (args, { signal }) =>
      answerOrFailure("token_risk", async () => {
        const view = await client.call("risk/check", args, { signal });
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
        return answer(jsonOf(ops["intent/get"].result, shown));
      }),
  });
}

/** The agent's read tools, in the order the model sees them. */
export function readTools(parts: AgentToolParts): readonly AgentTool[] {
  return [
    tokenSearchTool(parts),
    portfolioTool(parts),
    tokenInfoTool(parts),
    tokenRiskTool(parts),
    quoteTool(parts),
    ordersTool(parts),
    txStatusTool(parts),
  ];
}
