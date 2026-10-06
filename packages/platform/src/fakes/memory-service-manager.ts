import { err, ok } from "@binference/core";
import type { ServiceManager } from "../ports.js";
import {
  checkServiceDefinition,
  checkServiceName,
  type ServiceDefinition,
} from "../service/service-definition.js";

async function start(signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  await Promise.resolve();
}

/**
 * Creates a {@link ServiceManager} for tests that keeps its services in memory: an installed
 * service runs and starts at login until it is uninstalled. It checks names and definitions as
 * every adapter does.
 */
export function createMemoryServiceManager(): ServiceManager {
  const installed = new Map<string, ServiceDefinition>();
  return {
    install: async (definition, signal) => {
      checkServiceDefinition(definition);
      await start(signal);
      installed.set(definition.name, definition);
    },
    uninstall: async (name, signal) => {
      checkServiceName(name);
      await start(signal);
      return installed.delete(name) ? ok(undefined) : err("not_installed");
    },
    status: async (name, signal) => {
      checkServiceName(name);
      await start(signal);
      return installed.has(name)
        ? { state: "running", startsAtLogin: true }
        : { state: "not_installed" };
    },
  };
}
