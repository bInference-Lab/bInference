import { z } from "zod";

// Each read is parsed here: the SDK types its answers but does not check them. Integers arrive
// as bigint (the transport's parse); a token amount arrives as a decimal string.
const integer = z.bigint().nonnegative();
const amountText = z.string().regex(/^\d+$/).transform(BigInt);

/** One token account's holding in a transaction's meta. */
export interface TokenBalance {
  readonly mint: string;
  /** The wallet that owns the token account; absent in answers from before owners were listed. */
  readonly owner: string | undefined;
  readonly amount: bigint;
}

/** A transaction as `getTransaction` answers it with `jsonParsed`. */
export interface ParsedTransaction {
  readonly slot: bigint;
  /** Whether it ran and failed (`meta.err` is set). */
  readonly failed: boolean;
  /** Every account it names, loaded ones included, in the order its balances follow. */
  readonly accountKeys: readonly string[];
  readonly preBalances: readonly bigint[];
  readonly postBalances: readonly bigint[];
  readonly preTokenBalances: readonly TokenBalance[];
  readonly postTokenBalances: readonly TokenBalance[];
  /** The log lines the runtime and its programs wrote, in order; none when the node kept none. */
  readonly logMessages: readonly string[];
}

const tokenBalances = z
  .array(
    z.looseObject({
      mint: z.string(),
      owner: z.string().optional(),
      uiTokenAmount: z.looseObject({ amount: amountText }),
    }),
  )
  .default([])
  .transform((rows) =>
    rows.map(({ mint, owner, uiTokenAmount }) => ({ mint, owner, amount: uiTokenAmount.amount })),
  );

/** Parses `getTransaction`'s answer: a transaction, or `null` while no block holds it. */
export const transactionSchema: z.ZodType<ParsedTransaction | null> = z
  .looseObject({
    slot: integer,
    meta: z.looseObject({
      err: z.unknown(),
      preBalances: z.array(integer),
      postBalances: z.array(integer),
      preTokenBalances: tokenBalances,
      postTokenBalances: tokenBalances,
      logMessages: z.array(z.string()).nullish(),
    }),
    transaction: z.looseObject({
      message: z.looseObject({ accountKeys: z.array(z.looseObject({ pubkey: z.string() })) }),
    }),
  })
  .transform(({ slot, meta, transaction }) => ({
    slot,
    failed: meta.err !== null && meta.err !== undefined,
    accountKeys: transaction.message.accountKeys.map(({ pubkey }) => pubkey),
    preBalances: meta.preBalances,
    postBalances: meta.postBalances,
    preTokenBalances: meta.preTokenBalances,
    postTokenBalances: meta.postTokenBalances,
    logMessages: meta.logMessages ?? [],
  }))
  .nullable();

/** Parses `getBalance`'s answer to its lamports. */
export const lamportsSchema: z.ZodType<bigint> = z
  .looseObject({ value: integer })
  .transform(({ value }) => value);

/** Parses `getTokenAccountsByOwner`'s answer with `jsonParsed` to the sum its accounts hold. */
export const tokenAccountsSchema: z.ZodType<bigint> = z
  .looseObject({
    value: z.array(
      z.looseObject({
        account: z.looseObject({
          data: z.looseObject({
            parsed: z.looseObject({
              info: z.looseObject({ tokenAmount: z.looseObject({ amount: amountText }) }),
            }),
          }),
        }),
      }),
    ),
  })
  .transform(({ value }) =>
    value.reduce((sum, { account }) => sum + account.data.parsed.info.tokenAmount.amount, 0n),
  );

/** A mint account as `getAccountInfo` answers it with `jsonParsed`. */
export interface MintAccount {
  /** The token program that owns it. */
  readonly owner: string;
  /** The program's own name for itself, such as `spl-token`. */
  readonly program: string;
  readonly isInitialized: boolean;
  readonly decimals: number;
  readonly supply: bigint;
  readonly mintAuthority: string | undefined;
  readonly freezeAuthority: string | undefined;
}

const authority = z
  .string()
  .nullable()
  .optional()
  .transform((value) => value ?? undefined);

/** Parses `getAccountInfo`'s answer for a mint: `null` for no account, a fault for no mint. */
export const mintAccountSchema: z.ZodType<MintAccount | null> = z
  .looseObject({
    value: z
      .looseObject({
        owner: z.string(),
        data: z.looseObject({
          program: z.string(),
          parsed: z.looseObject({
            type: z.literal("mint"),
            info: z.looseObject({
              // Solana's SDK hands small fields such as decimals back as numbers.
              decimals: z.int().min(0).max(255),
              isInitialized: z.boolean(),
              supply: amountText,
              mintAuthority: authority,
              freezeAuthority: authority,
            }),
          }),
        }),
      })
      .nullable(),
  })
  .transform(({ value }) =>
    value === null
      ? null
      : { owner: value.owner, program: value.data.program, ...value.data.parsed.info },
  );
