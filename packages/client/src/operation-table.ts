import type { z } from "zod";

/**
 * One operation as a client calls it. `args` encodes what the caller passes into its wire form,
 * `result` parses the engine's answer, and `write` marks an operation whose every call carries an
 * idempotency key.
 */
export interface OperationContract {
  readonly args: z.ZodType;
  readonly result: z.ZodType;
  readonly write: boolean;
}

/** Every operation a client may call, by name, such as `intent/propose`, each with its contract. */
export type OperationTable<T> = { readonly [N in keyof T]: OperationContract };

/** The name of an operation in a table. */
export type OperationName<T extends OperationTable<T>> = keyof T & string;

/** What a caller passes to an operation: the decoded form of its args. */
export type OperationArgs<T extends OperationTable<T>, N extends OperationName<T>> = z.output<
  T[N]["args"]
>;

/** What an operation resolves with: its result as its schema parses it. */
export type OperationResult<T extends OperationTable<T>, N extends OperationName<T>> = z.output<
  T[N]["result"]
>;
