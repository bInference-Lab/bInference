/**
 * The longest one turn of the agent runtime runs from its `turn/start`: 10 minutes (runtime spec,
 * section 4.4). The runtime ends its turn then, and the engine ends a turn it still holds one
 * minute later (decision 0442): both read this one number, so the two never drift.
 */
export const maxTurnMs: number = 600_000;
