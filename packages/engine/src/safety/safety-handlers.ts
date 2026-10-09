import type { FreezeAgentsOptions } from "./freeze-agents.js";
import { createFreezeHandlers, type FreezeHandlers } from "./freeze-handlers.js";
import {
  createRescueHandlers,
  type RescueHandlers,
  type RescueHandlersOptions,
} from "./rescue-handlers.js";
import {
  createSafetyStatusHandlers,
  type SafetyStatusHandlers,
  type SafetyStatusOptions,
} from "./safety-status-handlers.js";

/** The handlers of the safety operations (protocol spec, section 7.1). */
export interface SafetyHandlers extends FreezeHandlers, RescueHandlers, SafetyStatusHandlers {}

/** What the safety operations read and write through. */
export interface SafetyHandlersOptions
  extends FreezeAgentsOptions, RescueHandlersOptions, SafetyStatusOptions {}

/** Creates the handlers of `safety/freeze`, `safety/rescue` and `safety/status`. */
export function createSafetyHandlers(options: SafetyHandlersOptions): SafetyHandlers {
  return {
    ...createFreezeHandlers(options),
    ...createRescueHandlers(options),
    ...createSafetyStatusHandlers(options),
  };
}
