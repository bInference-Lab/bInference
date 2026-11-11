import { createHash } from "node:crypto";
import { type ProtocolId, protocolIdSchema } from "@binference/protocol";

/**
 * What a `/skills` button asks for (decision 0408): apply or reject a skill proposal, by its id, or
 * accept a waiting workspace skill, by the digest of its agent, name and the folder hash the
 * message showed.
 */
export type SkillChoice =
  | { readonly act: "apply" | "reject"; readonly proposal: ProtocolId<"skillProposal"> }
  | { readonly act: "accept"; readonly digest: string };

const proposalPattern = /^bnf1:k:([ar]):(skp_[0-9a-f-]{36})$/;
const acceptPattern = /^bnf1:k:c:([\w-]{16})$/;

/**
 * A waiting skill's digest on its Accept button: the first 16 base64url characters of the SHA-256
 * of its agent, name and folder hash, so a press accepts only the files the message showed.
 */
export function waitingDigest(skill: {
  readonly agent: string;
  readonly name: string;
  readonly hash: string;
}): string {
  const text = `${skill.agent}/${skill.name}/${skill.hash}`;
  return createHash("sha256").update(text, "utf8").digest("base64url").slice(0, 16);
}

/**
 * The callback data of a `/skills` button, within Telegram's 64 bytes: `bnf1:k:a:<proposal>` to
 * apply, `bnf1:k:r:<proposal>` to reject, `bnf1:k:c:<digest>` to accept a waiting skill.
 */
export function skillCallbackData(choice: SkillChoice): string {
  if (choice.act === "accept") {
    return `bnf1:k:c:${choice.digest}`;
  }
  return `bnf1:k:${choice.act === "apply" ? "a" : "r"}:${choice.proposal}`;
}

/** The `/skills` choice the data holds, or `undefined` for data in any other form. */
export function skillChoiceOf(data: string): SkillChoice | undefined {
  const digest = acceptPattern.exec(data)?.[1];
  if (digest !== undefined) {
    return { act: "accept", digest };
  }
  const found = proposalPattern.exec(data);
  const proposal = protocolIdSchema("skillProposal").safeParse(found?.[2]);
  if (found === null || !proposal.success) {
    return undefined;
  }
  return { act: found[1] === "a" ? "apply" : "reject", proposal: proposal.data };
}
