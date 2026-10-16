import type {
  EngineCaller,
  EngineHandler,
  EngineHandlerTable,
  TurnMark,
} from "../operations/engine-call.js";
import type { RunningTurns } from "./running-turns.js";

/**
 * The operations that take their agent's turn mark: proposals (runtime spec, section 4.3), and the
 * agent's own workspace writes (decision 0242).
 */
type MarkedOperation =
  | "intent/propose"
  | "order/create"
  | "alert/create"
  | "schedule/create"
  | "agent/editFile";

// The caller as the server signed it in, with the mark of the turn it proposes in, or none.
function callerWith(caller: EngineCaller, mark: TurnMark | undefined): EngineCaller {
  const { credential, client, scopes, transport } = caller;
  return {
    credential,
    client,
    scopes,
    ...(transport === undefined ? {} : { transport }),
    ...(mark === undefined ? {} : { turn: mark }),
  };
}

function marked<N extends MarkedOperation>(
  handler: EngineHandler<N> | undefined,
  turns: RunningTurns,
): EngineHandler<N> | undefined {
  return handler === undefined
    ? undefined
    : async (call) => {
        const mark = turns.markOf(call.caller.credential, call.args.agent);
        return handler({ ...call, caller: callerWith(call.caller, mark) });
      };
}

/**
 * Wraps the handlers of `intent/propose`, `order/create`, `alert/create`, `schedule/create` and
 * `agent/editFile`, so each call carries the outside-content mark of its agent's running turn when
 * it is made with the token of the runtime's current start, and no mark otherwise, whatever the
 * caller held: such a call of a client with `agent` counts as outside content. Every other handler
 * is unchanged.
 */
export function markRuntimeTurns(
  handlers: EngineHandlerTable,
  turns: RunningTurns,
): EngineHandlerTable {
  const propose = marked(handlers["intent/propose"], turns);
  const order = marked(handlers["order/create"], turns);
  const alert = marked(handlers["alert/create"], turns);
  const schedule = marked(handlers["schedule/create"], turns);
  const edit = marked(handlers["agent/editFile"], turns);
  return {
    ...handlers,
    ...(propose === undefined ? {} : { "intent/propose": propose }),
    ...(order === undefined ? {} : { "order/create": order }),
    ...(alert === undefined ? {} : { "alert/create": alert }),
    ...(schedule === undefined ? {} : { "schedule/create": schedule }),
    ...(edit === undefined ? {} : { "agent/editFile": edit }),
  };
}
