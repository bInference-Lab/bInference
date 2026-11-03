import { BinferenceError } from "@binference/core";
import type { PublishPush } from "@binference/engine";
import { createWebhookIntake, webhookPortTakenNotice } from "@binference/engine/orders";
import { createWebhookListener, isPortTaken, type ServerAddress } from "@binference/server";
import type { Opened, Opening } from "./open-engine-parts.js";

/**
 * Starts the webhook listener on `127.0.0.1` at `engine.webhookPort` (spec 1, section 2.2), or the
 * port a test's host names, apart from the engine's port, and adds its closer. Opened after the
 * protocol server, it closes before it, so the shutdown takes no new alert first. A listener that
 * cannot bind leaves the engine running without it, logged as `webhook.listen_failed`, and
 * answers `undefined` (decision 0333): no alert arrives, so no fill runs. Only a port another
 * listener holds (`EADDRINUSE`) is told to the owner, in `notice.webhookPortTaken`; any other
 * failure, a stopped start among them, is logged only.
 */
export async function listenForWebhooks(
  opening: Opening,
  opened: Opened,
  publish: PublishPush,
): Promise<ServerAddress | undefined> {
  const { host, closers, signal } = opening;
  const logger = opened.log.logger.child("webhook");
  const port = host.webhookPort ?? opened.config.engine.webhookPort;
  const listener = createWebhookListener({
    port,
    intake: createWebhookIntake({ store: opened.stores.webhookAlerts, clock: host.clock }),
    clock: host.clock,
    logger,
  });
  try {
    const address = await listener.start(signal);
    closers.add("webhooks", async () => listener.close());
    return address;
  } catch (error) {
    if (error instanceof BinferenceError && error.code === "server.listen_failed") {
      logger.warn("webhook.listen_failed", { errorCode: error.code });
      if (isPortTaken(error)) {
        publish(webhookPortTakenNotice(port));
      }
      return undefined;
    }
    throw error;
  }
}
