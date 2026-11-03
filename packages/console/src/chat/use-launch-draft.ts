import {
  type LaunchDraftPush,
  type LaunchDraftView,
  launchDraftPushOf,
  type ProtocolId,
} from "@binference/protocol";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useEngine } from "../connection/engine-context";
import { useTopic } from "../connection/use-topic";
import { type DraftPicture, readDraftPicture } from "./draft-picture";

/** How a draft the page showed ended. */
type ClosedDraft = Extract<LaunchDraftPush, { readonly kind: "chat/launchDraftClosed" }>;

/** A draft that closed while the page showed it, and how it ended. */
export interface EndedDraft {
  readonly view: LaunchDraftView;
  readonly closed: ClosedDraft;
}

/** The agent's launch draft as the chat shows it, read-only (decision 0345). */
export interface AgentLaunchDraft {
  /** The open draft; none while the agent has none or it is still loading. */
  readonly open?: LaunchDraftView;
  /** The last draft this page showed, once it closed, until the next draft. */
  readonly ended?: EndedDraft;
  /** The open draft's photo, once read; none for a picture link or a photo the console refused. */
  readonly picture?: DraftPicture;
}

function draftKey(agent: ProtocolId<"agent">): readonly string[] {
  return ["launchDraft", agent];
}

// The open draft's photo, read part by part once per draft.
function usePicture(agent: ProtocolId<"agent">, open: LaunchDraftView | undefined) {
  const { client } = useEngine();
  const bytes = open?.picture?.bytes;
  const draft = open?.draft;
  return useQuery({
    queryKey: [...draftKey(agent), draft, "picture"],
    enabled: draft !== undefined && bytes !== undefined,
    queryFn: async ({ signal }) =>
      readDraftPicture(client, { agent, draft: draft ?? "", bytes: bytes ?? 0 }, signal),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
}

/**
 * The agent's open launch draft (decision 0345): read with `launch/openDraft` when the chat
 * opens, again at each draft push and after a gap in the agent's chat topic, with its photo read
 * from its bytes. A draft that closes while shown stays, with how it ended, until the next one.
 */
export function useLaunchDraft(agent: ProtocolId<"agent">): AgentLaunchDraft {
  const { client } = useEngine();
  const queries = useQueryClient();
  const key = draftKey(agent);
  const [ended, setEnded] = useState<EndedDraft | undefined>(undefined);
  const open = useQuery({
    queryKey: key,
    queryFn: async ({ signal }) =>
      (await client.call("launch/openDraft", { agent }, { signal })).draft ?? null,
    retry: false,
  });
  const reload = async (): Promise<void> => queries.invalidateQueries({ queryKey: key });
  useTopic(`chat:${agent}`, {
    onPush: (frame) => {
      const push = launchDraftPushOf(frame);
      if (push === undefined) {
        return;
      }
      const shown = queries.getQueryData<LaunchDraftView | null>(key);
      setEnded(
        push.kind === "chat/launchDraftClosed" && shown?.draft === push.draft
          ? { view: shown, closed: push }
          : undefined,
      );
      void reload();
    },
    refetch: reload,
  });
  const shown = open.data ?? undefined;
  const picture = usePicture(agent, shown ?? ended?.view).data ?? undefined;
  return {
    ...(shown === undefined ? {} : { open: shown }),
    ...(ended === undefined ? {} : { ended }),
    ...(picture === undefined ? {} : { picture }),
  };
}
