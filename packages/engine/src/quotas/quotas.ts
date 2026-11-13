/**
 * A store call of a write that adds what a quota counts (decision 0431). `quota` is the most the
 * write may leave; with none, the write counts nothing.
 */
export interface QuotaCall {
  readonly signal: AbortSignal;
  readonly quota?: number;
}
