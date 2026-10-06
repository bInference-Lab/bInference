/**
 * One check of a port's contract suite. An adapter's test runs every check of its port's suite,
 * so each adapter behaves as the port promises.
 */
export interface ContractCheck {
  /** A sentence that names the behavior, usable as a test title. */
  readonly name: string;
  /** Resolves when the adapter behaves; rejects with an assertion error when it does not. */
  readonly run: () => Promise<void>;
}
