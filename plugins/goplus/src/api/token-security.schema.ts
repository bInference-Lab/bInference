import { z } from "zod";

/**
 * One token's fields of GoPlus's token security answer that the source reads. GoPlus writes each
 * flag as `"1"` (true), `"0"` (false) or leaves it out (unknown), taxes as decimals from 0 to 1,
 * and liquidity in USD as decimal text. Fields GoPlus adds later pass through unread.
 */
export interface GoplusToken {
  readonly flags: Readonly<Record<string, string | undefined>>;
  readonly buyTax?: string;
  readonly sellTax?: string;
  /** Each pool's liquidity in USD, as GoPlus writes it. */
  readonly liquidities: readonly string[];
  /** Set when GoPlus found the token to copy a mainstream asset. */
  readonly isFake: boolean;
}

/** The answer's envelope: GoPlus's code (1 is success), and the result by contract address. */
export interface GoplusAnswer {
  readonly code: number;
  /** Each token GoPlus knows, keyed by its address in lowercase; absent on an error. */
  readonly tokens?: Readonly<Record<string, GoplusToken>>;
}

// The flag fields the source reads, as GoPlus names them.
const goplusFlagFields = [
  "is_honeypot",
  "cannot_sell_all",
  "cannot_buy",
  "hidden_owner",
  "owner_change_balance",
  "can_take_back_ownership",
  "is_blacklisted",
  "is_whitelisted",
  "transfer_pausable",
  "slippage_modifiable",
  "personal_slippage_modifiable",
  "trading_cooldown",
  "is_anti_whale",
  "is_mintable",
  "is_proxy",
  "is_open_source",
  "selfdestruct",
  "is_true_token",
  "is_airdrop_scam",
] as const;

const text = z.string().optional();
const dexSchema = z.looseObject({ liquidity: z.string().optional() });

const tokenSchema: z.ZodType<GoplusToken> = z
  .looseObject({
    is_honeypot: text,
    cannot_sell_all: text,
    cannot_buy: text,
    hidden_owner: text,
    owner_change_balance: text,
    can_take_back_ownership: text,
    is_blacklisted: text,
    is_whitelisted: text,
    transfer_pausable: text,
    slippage_modifiable: text,
    personal_slippage_modifiable: text,
    trading_cooldown: text,
    is_anti_whale: text,
    is_mintable: text,
    is_proxy: text,
    is_open_source: text,
    selfdestruct: text,
    is_true_token: text,
    is_airdrop_scam: text,
    buy_tax: text,
    sell_tax: text,
    dex: z.array(dexSchema).optional(),
    fake_token: z.unknown().optional(),
  })
  .transform((token) => ({
    flags: Object.fromEntries(goplusFlagFields.map((field) => [field, token[field]])),
    ...(token.buy_tax === undefined ? {} : { buyTax: token.buy_tax }),
    ...(token.sell_tax === undefined ? {} : { sellTax: token.sell_tax }),
    liquidities: (token.dex ?? []).flatMap((pool) =>
      pool.liquidity === undefined ? [] : [pool.liquidity],
    ),
    isFake: token.fake_token !== undefined && token.fake_token !== null,
  }));

const answerSchema: z.ZodType<GoplusAnswer> = z
  .looseObject({
    code: z.int(),
    result: z.record(z.string(), tokenSchema).nullable().optional(),
  })
  .transform((answer) => ({
    code: answer.code,
    ...(answer.result === undefined || answer.result === null ? {} : { tokens: answer.result }),
  }));

/** Parses JSON text from GoPlus's API; text that is no JSON or breaks the schema is undefined. */
export function readGoplusAnswer(body: string): GoplusAnswer | undefined {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return undefined;
  }
  const answer = answerSchema.safeParse(json);
  return answer.success ? answer.data : undefined;
}
