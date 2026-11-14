import type { AgentView, ProtocolId, ResultOf, SkillProposalDetail } from "@binference/protocol";
import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEngine } from "../connection/engine-context";

/** The pending skill proposals of every agent, as `skillProposal/list` answers them. */
export type ProposalPage = ResultOf<"skillProposal/list">;

/** One skill as `skill/list` answers it. */
type ShelfSkill = ResultOf<"skill/list">["items"][number];

/** A waiting workspace skill, which loads once the owner accepts its files. */
export type WaitingSkill = ShelfSkill;

/** A skill the agent can load, with the name of the agent whose workspace holds it, if any. */
export interface InstalledSkill {
  readonly skill: ShelfSkill;
  readonly agentName?: string;
}

/** The installed skills once every list answered, or why one did not. */
export interface InstalledSkills {
  readonly data: readonly InstalledSkill[] | undefined;
  readonly error: Error | null;
}

const callMs = 30_000;

// Every query of this screen sits under `skills`, so a decision reloads them all.
const skillsKey = ["skills"] as const;

/** Every agent's pending skill proposals (decision 0408), newest first. */
export function usePendingProposals(): UseQueryResult<ProposalPage> {
  const { client } = useEngine();
  return useQuery({
    queryKey: [...skillsKey, "proposals"],
    queryFn: async ({ signal }) =>
      client.call("skillProposal/list", { status: "pending", limit: 50 }, { signal }),
  });
}

/** One proposal whole: its text, files, findings and diff. */
export function useProposal(
  proposal: ProtocolId<"skillProposal">,
): UseQueryResult<SkillProposalDetail> {
  const { client } = useEngine();
  return useQuery({
    queryKey: [...skillsKey, "proposals", proposal],
    queryFn: async ({ signal }) => client.call("skillProposal/get", { proposal }, { signal }),
  });
}

// One agent's list, which holds its index and its waiting workspace skills; one query serves both.
function agentSkills(client: ReturnType<typeof useEngine>["client"], agent: ProtocolId<"agent">) {
  return {
    queryKey: [...skillsKey, "agent", agent],
    queryFn: async ({ signal }: { readonly signal: AbortSignal }) =>
      (await client.call("skill/list", { agent }, { signal })).items,
  };
}

/** One agent's workspace skills that wait for the owner to accept their files. */
export function useWaitingSkills(
  agent: ProtocolId<"agent">,
): UseQueryResult<readonly WaitingSkill[]> {
  const { client } = useEngine();
  return useQuery({
    ...agentSkills(client, agent),
    select: (items) => items.filter(({ held }) => held === true),
  });
}

/** Whether a workspace skill of any of these agents waits for the owner to accept its files. */
export function useAnySkillWaiting(agents: readonly AgentView[]): boolean {
  const { client } = useEngine();
  return useQueries({
    queries: agents.map(({ agent }) => agentSkills(client, agent)),
    combine: (lists) => lists.some((list) => list.data?.some(({ held }) => held === true) === true),
  });
}

/**
 * The skills the agents can load (decision 0207): the bundled and installed ones, which
 * `skill/list` answers without an agent, then each agent's own workspace skills that load, by name.
 */
export function useInstalledSkills(agents: readonly AgentView[]): InstalledSkills {
  const { client } = useEngine();
  const shelf = {
    queryKey: [...skillsKey, "shelf"],
    queryFn: async ({ signal }: { readonly signal: AbortSignal }) =>
      (await client.call("skill/list", {}, { signal })).items,
  };
  return useQueries({
    queries: [shelf, ...agents.map(({ agent }) => agentSkills(client, agent))],
    combine: (lists): InstalledSkills => {
      const [shared, ...own] = lists;
      const error = lists.find((list) => list.error !== null)?.error ?? null;
      if (shared?.data === undefined || own.some((list) => list.data === undefined)) {
        return { data: undefined, error };
      }
      const workspace = own.flatMap((list, index) => {
        const agentName = agents[index]?.name;
        return (list.data ?? [])
          .filter(({ place, held }) => place === "workspace" && held !== true)
          .map((skill): InstalledSkill =>
            agentName === undefined ? { skill } : { skill, agentName },
          );
      });
      const data = [...shared.data.map((skill) => ({ skill })), ...workspace].toSorted(
        (one, two) => (one.skill.name < two.skill.name ? -1 : 1),
      );
      return { data, error };
    },
  });
}

/** What the owner does with a proposal: apply it, or reject it. */
type ProposalAct = "apply" | "reject";

/** Applies or rejects a proposal, then loads the proposals and skills again. */
export function useDecideProposal(): UseMutationResult<
  ResultOf<"skillProposal/apply">,
  Error,
  { readonly proposal: ProtocolId<"skillProposal">; readonly act: ProposalAct }
> {
  const { client } = useEngine();
  const queries = useQueryClient();
  return useMutation({
    mutationFn: async ({ proposal, act }) =>
      client.call(
        act === "apply" ? "skillProposal/apply" : "skillProposal/reject",
        { proposal },
        {
          signal: AbortSignal.timeout(callMs),
        },
      ),
    onSettled: async () => queries.invalidateQueries({ queryKey: skillsKey }),
  });
}

/** Accepts a waiting skill at the folder hash the owner was shown. */
export function useAcceptSkill(): UseMutationResult<
  object,
  Error,
  { readonly agent: ProtocolId<"agent">; readonly skill: string; readonly hash: string }
> {
  const { client } = useEngine();
  const queries = useQueryClient();
  return useMutation({
    mutationFn: async (args) =>
      client.call("skill/accept", args, { signal: AbortSignal.timeout(callMs) }),
    onSettled: async () => queries.invalidateQueries({ queryKey: skillsKey }),
  });
}
