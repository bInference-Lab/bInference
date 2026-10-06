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

/** Where a push subscription starts: at `fromSeq`, or at the next push when it is absent. */
export interface TopicStart {
  readonly fromSeq?: number;
}

/** What the client sends to `push/subscribe`: each topic with where it starts. */
export interface SubscribeArgs {
  readonly topics: Readonly<Record<string, TopicStart>>;
}

/**
 * What `push/subscribe` answers: the current `seq` of each topic, and the topics whose missed
 * pushes the engine no longer holds, which the client refetches.
 */
export interface SubscribeResult {
  readonly seqs: Readonly<Record<string, number>>;
  readonly resync?: readonly string[];
}

/** What the client sends to `push/unsubscribe`. */
export interface UnsubscribeArgs {
  readonly topics: readonly string[];
}

/** An operation whose args and result the client builds and reads itself. */
export interface KnownOperation<Args, Result> extends OperationContract {
  readonly args: z.ZodType<Args>;
  readonly result: z.ZodType<Result>;
}

/** The operations the client calls itself to keep pushes flowing. */
export interface SubscriptionOperations {
  readonly "push/subscribe": KnownOperation<SubscribeArgs, SubscribeResult>;
  readonly "push/unsubscribe": OperationContract & { readonly args: z.ZodType<UnsubscribeArgs> };
}

/**
 * Every operation a client may call, by name, such as `intent/propose`, each with its contract.
 * The table must hold `push/subscribe` and `push/unsubscribe`, which the client calls itself.
 */
export type OperationTable<T> = {
  readonly [N in keyof T]: OperationContract;
} & SubscriptionOperations;

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
