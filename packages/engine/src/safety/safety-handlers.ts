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
import {
  createUnfreezeHandlers,
  type UnfreezeHandlers,
  type UnfreezeHandlersOptions,
} from "./unfreeze-handlers.js";

/** The handlers of the safety operations (protocol spec, section 7.1). */
export interface SafetyHandlers
  extends FreezeHandlers, RescueHandlers, SafetyStatusHandlers, UnfreezeHandlers {}

/** What the safety operations read and write through. */
export interface SafetyHandlersOptions
  extends
    FreezeAgentsOptions,
    RescueHandlersOptions,
    SafetyStatusOptions,
    UnfreezeHandlersOptions {}

/** Creates the handlers of `safety/freeze`, `safety/unfreeze`, `safety/rescue` and `safety/status`. */
export function createSafetyHandlers(options: SafetyHandlersOptions): SafetyHandlers {
  return {
    ...createFreezeHandlers(options),
    ...createRescueHandlers(options),
    ...createSafetyStatusHandlers(options),
    ...createUnfreezeHandlers(options),
  };
}
