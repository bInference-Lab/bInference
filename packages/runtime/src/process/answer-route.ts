import { answerDeleteRoute, type DeleteRouteParts, isDeleteRoute } from "../chats/delete-route.js";
import {
  answerMessagesRoute,
  isMessagesRoute,
  type MessageRouteParts,
} from "../chats/message-routes.js";
import type { RouteLine, RuntimeLine } from "../control/control-line.schema.js";
import { answerGoalRoute, type GoalRouteParts, isGoalRoute } from "../goals/goal-routes.js";
import { answerNoteRoute, isNoteRoute, type NoteRouteParts } from "../notes/note-routes.js";

/**
 * What the routed operations read and write: the notes, the transcripts, the chats' goals and the
 * deletion of chats.
 */
export interface RouteParts {
  readonly notes: NoteRouteParts;
  readonly messages: MessageRouteParts;
  readonly goals: GoalRouteParts;
  readonly deletion: DeleteRouteParts;
  readonly lifetime: AbortSignal;
}

// A routed operation the runtime does not serve yet is refused as one it does not know.
function refusedRoute(route: RouteLine): RuntimeLine {
  return {
    t: "routeReply",
    id: route.id,
    error: {
      code: "protocol.unknown_op",
      message: `The agent runtime does not serve ${route.op}.`,
      retryable: false,
    },
  };
}

/**
 * Answers one routed operation (runtime spec, section 10): `chat/messages` from the transcripts,
 * `chat/delete` by deleting the agents' chats (decision 0415), the goal operations from the chats'
 * goals (decision 0407), the notes operations from the notes, and any other as one the runtime
 * does not know.
 */
export async function answerRoute(route: RouteLine, parts: RouteParts): Promise<RuntimeLine> {
  if (isMessagesRoute(route)) {
    return answerMessagesRoute(route, parts.messages, parts.lifetime);
  }
  if (isDeleteRoute(route)) {
    return answerDeleteRoute(route, parts.deletion, parts.lifetime);
  }
  if (isGoalRoute(route)) {
    return answerGoalRoute(route, parts.goals, parts.lifetime);
  }
  return isNoteRoute(route)
    ? answerNoteRoute(route, parts.notes, parts.lifetime)
    : refusedRoute(route);
}
