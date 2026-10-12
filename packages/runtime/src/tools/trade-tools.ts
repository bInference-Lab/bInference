import { BinferenceError } from "@binference/core";
import {
  type BuyTerms,
  buyTermsSchema,
  type IntentRequest,
  orderProposalAnswer,
  type OrderTerms,
  orderTermsSchema,
  proposalAnswer,
  type SellTerms,
  sellTermsSchema,
  type SwapTerms,
  swapTermsSchema,
} from "@binference/protocol";
import { z } from "zod";
import type { ToolOutcome, ToolRunContext } from "../loop/turn-records.js";
import { agentToolTexts } from "./agent-tool-texts.js";
import { type AgentTool, defineTool } from "./define-tool.js";
import { failedAnswer, isEngineRefusal, isRefusedState } from "./tool-answer.js";
import type { AgentToolParts, ToolClient } from "./tool-client.js";

// The agent's propose tools (runtime spec, sections 5.1 and 6.1). The model gives the terms and
// its reason; the tool names the agent of its turn and no wallet, so the engine acts from the
// agent's default wallet. Each call sends the call's key as its idempotency key, so a resend on
// a new connection returns the first intent. The answer names the intent or the order and says
// it waits for the owner, and nothing more: the card speaks for the proposal, and the next turn
// reads its outcome. It never waits for the tap.

// A refusal the engine answered is a result; anything uncertain throws, so the loop takes the
// proposal's outcome as unknown and never sends it again.
function refusedOrThrow(tool: string, error: BinferenceError): ToolOutcome {
  if (!isEngineRefusal(error)) {
    throw error;
  }
  return failedAnswer(tool, error);
}

async function proposeIntent(
  client: ToolClient,
  request: IntentRequest,
  { signal, idempotencyKey }: ToolRunContext,
): Promise<ToolOutcome> {
  try {
    const intent = await client.call("intent/propose", request, { signal, key: idempotencyKey });
    return { text: proposalAnswer(intent), isError: isRefusedState(intent.state) };
  } catch (error) {
    if (error instanceof BinferenceError) {
      return refusedOrThrow(request.kind, error);
    }
    throw error;
  }
}

function swapTool({ agent, client }: AgentToolParts): AgentTool {
  return defineTool<SwapTerms>({
    name: "swap",
    kind: "propose",
    description: agentToolTexts.swap,
    args: swapTermsSchema,
    run: async (terms, context) =>
      proposeIntent(client, { ...terms, agent, kind: "swap" }, context),
  });
}

function buyTool({ agent, client }: AgentToolParts): AgentTool {
  return defineTool<BuyTerms>({
    name: "buy",
    kind: "propose",
    description: agentToolTexts.buy,
    args: buyTermsSchema,
    run: async (terms, context) => proposeIntent(client, { ...terms, agent, kind: "buy" }, context),
  });
}

function sellTool({ agent, client }: AgentToolParts): AgentTool {
  return defineTool<SellTerms>({
    name: "sell",
    kind: "propose",
    description: agentToolTexts.sell,
    args: sellTermsSchema,
    run: async (terms, context) =>
      proposeIntent(client, { ...terms, agent, kind: "sell" }, context),
  });
}

/**
 * What `order_create` takes: the order, one of six kinds. A model's tool takes an object at its
 * root, so the order's union sits in one field.
 */
interface OrderCreateArgs {
  readonly order: OrderTerms;
}

const orderCreateArgs: z.ZodType<OrderCreateArgs> = z.strictObject({ order: orderTermsSchema });

function orderCreateTool({ agent, client }: AgentToolParts): AgentTool {
  return defineTool<OrderCreateArgs>({
    name: "order_create",
    kind: "propose",
    description: agentToolTexts.order_create,
    args: orderCreateArgs,
    run: async ({ order: terms }, { signal, idempotencyKey }) => {
      try {
        const request = { ...terms, agent };
        const order = await client.call("order/create", request, { signal, key: idempotencyKey });
        return { text: orderProposalAnswer(order), isError: false };
      } catch (error) {
        if (error instanceof BinferenceError) {
          return refusedOrThrow("order_create", error);
        }
        throw error;
      }
    },
  });
}

/** The agent's propose tools, in the order the model sees them. */
export function tradeTools(parts: AgentToolParts): readonly AgentTool[] {
  return [swapTool(parts), buyTool(parts), sellTool(parts), orderCreateTool(parts)];
}
