import type { TxDraft } from "@binference/chain";

/** The one draft at `index` of a build, which must be there. */
export function draftAt(drafts: readonly TxDraft[], index: number): TxDraft {
  const draft = drafts[index];
  if (draft === undefined) {
    throw new Error(`The build has no draft ${String(index)}.`);
  }
  return draft;
}
