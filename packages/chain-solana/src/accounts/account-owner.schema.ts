import { z } from "zod";

/** Who owns an account, whether it is a program, and how many bytes of data it holds. */
export interface AccountOwner {
  /** The program that owns the account. */
  readonly owner: string;
  readonly executable: boolean;
  /** The bytes of data the account holds: none for a wallet, some for a durable nonce. */
  readonly space: bigint;
}

/** Parses `getAccountInfo`'s answer to the account's owner: `null` while no account exists. */
export const accountOwnerSchema: z.ZodType<AccountOwner | null> = z
  .looseObject({
    value: z
      .looseObject({
        owner: z.string(),
        executable: z.boolean(),
        // Integers arrive as bigint, the transport's parse.
        space: z.bigint().nonnegative(),
      })
      .nullable(),
  })
  .transform(({ value }) =>
    value === null
      ? null
      : { owner: value.owner, executable: value.executable, space: value.space },
  );
