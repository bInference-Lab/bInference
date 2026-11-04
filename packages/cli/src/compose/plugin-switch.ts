import type { RuntimePlugin } from "@binference/runtime";

/** Whether the agent is offered a community plugin's tools, kept with what the runtime holds. */
export interface PluginSwitch {
  /** Hands the runtime the plugins on, through `apply`. */
  offer(plugins: readonly RuntimePlugin[]): Promise<void>;
  /** Whether the runtime may hold a community plugin's tools now (decision 0350). */
  isOn(): boolean;
}

/**
 * Keeps whether a community plugin offers the agent tools on the safe side of what the runtime
 * holds (decision 0350): it turns on before `apply` hands the runtime a list with tools, and off
 * only once `apply` settled with a list without any, so the engine never stops marking a turn
 * the runtime may still start with a plugin's words.
 */
export function createPluginSwitch(
  apply: (plugins: readonly RuntimePlugin[]) => Promise<void>,
): PluginSwitch {
  const state = { isOn: false };
  return {
    async offer(plugins) {
      const on = plugins.some(({ tools }) => tools.length > 0);
      state.isOn ||= on;
      await apply(plugins);
      state.isOn = on;
    },
    isOn: () => state.isOn,
  };
}
