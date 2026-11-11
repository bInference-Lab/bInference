import type { ProtocolId } from "@binference/protocol";
import { noticeTableParts } from "./notice-table-parts.js";
import type { WrittenNotice } from "./write-notice.js";

const { tableAgent, agent } = noticeTableParts;

const named = { ...agent, name: "dip-buyer" };

/**
 * One notice of each skill key of spec 4, section 4.5, as the engine publishes it (decision
 * 0408): a proposal made with a finding that blocks it, a proposal applied and one rejected, a
 * workspace skill that waits for the owner, and one the owner accepted.
 */
export const skillNoticeTable: Readonly<
  Record<string, WrittenNotice & { readonly agent: ProtocolId<"agent"> }>
> = {
  "notice.skillProposed": {
    key: "notice.skillProposed",
    agent: tableAgent,
    values: {
      ...named,
      proposal: "skp_0190f1c2-3a4b-7c5d-8e6f-000000000001",
      revised: "no",
      blocked: "yes",
    },
  },
  "notice.skillApplied": {
    key: "notice.skillApplied",
    agent: tableAgent,
    values: { ...named, surface: "telegram" },
  },
  "notice.skillRejected": {
    key: "notice.skillRejected",
    agent: tableAgent,
    values: { ...named, surface: "cli" },
  },
  "notice.skillHeld": { key: "notice.skillHeld", agent: tableAgent, values: named },
  "notice.skillAccepted": {
    key: "notice.skillAccepted",
    agent: tableAgent,
    values: { ...named, surface: "console" },
  },
};
