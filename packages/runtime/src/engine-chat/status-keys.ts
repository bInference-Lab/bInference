import type { ImageProblem, TurnStatusLine } from "../loop/turn-records.js";

/** One status line as `turn/status` sends it: its key in spec 4 and the values it takes. */
export interface StatusKey {
  readonly key: string;
  readonly values?: Readonly<Record<string, number>>;
}

type Failure = Extract<TurnStatusLine, { readonly line: "failed" }>["failure"];

const failureKeys: Readonly<Record<Failure, string>> = {
  transient: "turn.failed.transient",
  context: "turn.failed.context",
  auth: "turn.failed.auth",
  billing: "turn.failed.billing",
  request: "turn.failed.request",
  refused: "turn.failed.refused",
  aborted: "turn.failed.aborted",
  time_limit: "turn.failed.timeLimit",
  proposal_unknown: "turn.failed.proposalUnknown",
  engine: "turn.failed.engine",
};

// The limits the owner's image passed (protocol spec, section 7.7), named in the line's words.
const imageKeys: Readonly<Record<ImageProblem, StatusKey>> = {
  tooMany: { key: "turn.image.tooMany", values: { count: 4 } },
  tooLarge: { key: "turn.image.tooLarge", values: { mib: 5 } },
  format: { key: "turn.image.format" },
  unreadable: { key: "turn.image.unreadable" },
  noVision: { key: "turn.image.noVision" },
};

/**
 * The status lines of spec 4, section 8.1, that a turn's line goes out as, in order. Held-back
 * proposals go out after the line that the card waits; a refused proposal sends none, since its
 * settle message starts the turn that reports it.
 */
export function statusKeysOf(line: TurnStatusLine): readonly StatusKey[] {
  if (line.line === "moreProposals") {
    return [
      { key: "turn.proposalWaits" },
      { key: "turn.moreProposals", values: { count: line.count } },
    ];
  }
  if (line.line === "failed") {
    return [{ key: failureKeys[line.failure] }];
  }
  if (line.line === "budget") {
    return [{ key: "turn.budget", values: { when: line.resumesAt } }];
  }
  if (line.line === "image") {
    return [imageKeys[line.problem]];
  }
  return line.line === "proposalRefused" ? [] : [{ key: `turn.${line.line}` }];
}
