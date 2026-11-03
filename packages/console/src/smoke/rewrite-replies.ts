import type { Page, WebSocketRoute } from "@playwright/test";
import { readAnswer, readCall, type ReplyRewrite } from "./smoke-frames.schema";

/**
 * What the page's link to the smoke engine answers instead, by operation: the engine's result,
 * none when it failed, becomes the rewrite's result. Every other frame passes as it was sent.
 */
export type ReplyRewrites = Readonly<Record<string, ReplyRewrite>>;

function relay(route: WebSocketRoute, rewrites: ReplyRewrites): void {
  const server = route.connectToServer();
  const asked = new Map<string, ReplyRewrite>();
  route.onMessage((message) => {
    const call = readCall(message.toString());
    const rewrite = call === undefined ? undefined : rewrites[call.op];
    if (call !== undefined && rewrite !== undefined) {
      asked.set(call.id, rewrite);
    }
    server.send(message);
  });
  server.onMessage((message) => {
    const answer = readAnswer(message.toString());
    const rewrite = answer === undefined ? undefined : asked.get(answer.id);
    if (answer === undefined || rewrite === undefined) {
      route.send(message);
      return;
    }
    asked.delete(answer.id);
    route.send(JSON.stringify({ t: "reply", id: answer.id, result: rewrite(answer.result) }));
  });
}

/**
 * Rewrites the engine's answers to the operations named, on every link the page opens from now
 * on. The smoke engine runs no staking venue, bridge or drafting agent, so a test that shows them
 * gives the screen their answers this way.
 */
export async function rewriteReplies(page: Page, rewrites: ReplyRewrites): Promise<void> {
  await page.routeWebSocket("**/ws", (route) => {
    relay(route, rewrites);
  });
}
