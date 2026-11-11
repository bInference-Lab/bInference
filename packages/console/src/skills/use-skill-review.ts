import type { ProtocolId, ResultOf, SkillProposalDetail } from "@binference/protocol";
import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEngine } from "../connection/engine-context";

/** The pending skill proposals of every agent, as `skillProposal/list` answers them. */
export type ProposalPage = ResultOf<"skillProposal/list">;

/** One agent's skills as `skill/list` answers them, its waiting workspace skills among them. */
type SkillPage = ResultOf<"skill/list">;

/** A waiting workspace skill, which loads once the owner accepts its files. */
export type WaitingSkill = SkillPage["items"][number];

const callMs = 30_000;

/** Every agent's pending skill proposals (decision 0408), newest first. */
export function usePendingProposals(): UseQueryResult<ProposalPage> {
  const { client } = useEngine();
  return useQuery({
    queryKey: ["skillProposals"],
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
    queryKey: ["skillProposals", proposal],
    queryFn: async ({ signal }) => client.call("skillProposal/get", { proposal }, { signal }),
  });
}

/** One agent's workspace skills that wait for the owner to accept their files. */
export function useWaitingSkills(
  agent: ProtocolId<"agent">,
): UseQueryResult<readonly WaitingSkill[]> {
  const { client } = useEngine();
  return useQuery({
    queryKey: ["skillProposals", "waiting", agent],
    queryFn: async ({ signal }) => {
      const page = await client.call("skill/list", { agent }, { signal });
      return page.items.filter(({ held }) => held === true);
    },
  });
}

/** What the owner does with a proposal: apply it, or reject it. */
type ProposalAct = "apply" | "reject";

/** Applies or rejects a proposal, then loads the proposals and waiting skills again. */
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
    onSettled: async () => queries.invalidateQueries({ queryKey: ["skillProposals"] }),
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
    onSettled: async () => queries.invalidateQueries({ queryKey: ["skillProposals"] }),
  });
}
