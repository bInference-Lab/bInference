import type { Clock } from "@binference/core";
import { countNotice, type NoticeHour } from "../notices/notice-hour.js";
import type { PublishPush } from "./engine-push.js";
import { noticePush } from "./notice-push.js";

/**
 * What the plugin host tells the owner (decision 0300): a community plugin asked for a host it
 * does not declare, crashed 5 times in 10 minutes and is off, left what the host sent it unread
 * and was ended, or cannot run on this machine because the sandbox does not hold, with the first
 * act that went through as `reason`.
 */
export type PluginNotice =
  | { readonly kind: "hostRefused"; readonly plugin: string; readonly host: string }
  | { readonly kind: "stopped"; readonly plugin: string }
  | { readonly kind: "stalled"; readonly plugin: string }
  | { readonly kind: "sandboxOff"; readonly reason: string };

// A host is the plugin's own choice: the notice shows at most this much of it.
const maxHostChars = 64;
// The plugins whose notice hours are kept; past it the oldest is forgotten.
const maxPlugins = 1_000;

function hostText(host: string): string {
  return host.length <= maxHostChars ? host : `${host.slice(0, maxHostChars - 1)}…`;
}

function counter(): (plugin: string, atMs: number) => ReturnType<typeof countNotice> {
  const hours = new Map<string, NoticeHour>();
  return (plugin, atMs) => {
    const counted = countNotice(hours.get(plugin), atMs);
    hours.delete(plugin);
    hours.set(plugin, counted.window);
    const oldest = hours.size > maxPlugins ? hours.keys().next().value : undefined;
    if (oldest !== undefined) {
      hours.delete(oldest);
    }
    return counted;
  };
}

/**
 * Tells the owner of the plugin host's events (spec 4, section 4.4): `notice.pluginStopped`,
 * `notice.pluginStalled` and `notice.pluginSandboxOff` as they come, and
 * `notice.pluginHostRefused` at most five times an hour per plugin, with the host cut to 64
 * characters; the refusals an hour held back are told in one `notice.pluginHostsHeld` with the
 * next refusal after it. They name no agent: plugins serve the whole install.
 */
export function createPluginNotices(parts: {
  readonly clock: Clock;
  readonly publish: PublishPush;
}): (notice: PluginNotice) => void {
  const count = counter();
  return (notice) => {
    switch (notice.kind) {
      case "hostRefused": {
        const { plugin } = notice;
        const counted = count(plugin, parts.clock.now());
        if (counted.heldBefore > 0) {
          const values = { plugin, count: String(counted.heldBefore) };
          parts.publish(noticePush({ key: "notice.pluginHostsHeld", values }));
        }
        if (counted.notify) {
          const values = { plugin, host: hostText(notice.host) };
          parts.publish(noticePush({ key: "notice.pluginHostRefused", values }));
        }
        return;
      }
      case "stopped":
      case "stalled": {
        const key = notice.kind === "stopped" ? "notice.pluginStopped" : "notice.pluginStalled";
        parts.publish(noticePush({ key, values: { plugin: notice.plugin } }));
        return;
      }
      case "sandboxOff":
        parts.publish(
          noticePush({ key: "notice.pluginSandboxOff", values: { reason: notice.reason } }),
        );
    }
  };
}
