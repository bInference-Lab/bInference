const whole = 10_000n;
// Whatever the launch-window tax, the curve leaves a buyer at least this share of the spend.
const keptBps = 100n;

/** What prices a trade on a curve: its reserves and the shares it takes of the quote side. */
export interface CurveTerms {
  /** The curve's quote reserve, its virtual part included, in base units. */
  readonly quoteReserve: bigint;
  readonly tokenReserve: bigint;
  /** The curve's own fee, in basis points of the quote side. */
  readonly feeBps: bigint;
  /** The launch's creator tax, in basis points of the quote side. */
  readonly creatorTaxBps: bigint;
}

/** {@link CurveTerms} of a buy, with the snipe tax the curve reads for its recipient now. */
export interface BuyTerms extends CurveTerms {
  /** `currentSnipeTaxBps(recipient)`, before the curve bounds it. */
  readonly snipeTaxBps: bigint;
}

/** What a buy of an exact input gets: the tokens, and the shares of the input the curve keeps. */
export interface BuyOutcome {
  readonly tokensOut: bigint;
  /** The snipe tax the curve charges, after its bound, in basis points of the input. */
  readonly snipeTaxBps: bigint;
  /** What the input pays in creator tax and snipe tax, in base units. */
  readonly taxPaid: bigint;
}

/** What a sale of an exact input gets: the quote asset, and what the curve keeps of it. */
export interface SellOutcome {
  readonly quoteOut: bigint;
  /** What the sale pays in creator tax, in base units. */
  readonly taxPaid: bigint;
}

// The constant-product output for an input the curve has already taken its shares from. The
// curve refuses a trade of nothing, with an empty reserve, or that would pay nothing.
function productOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint | undefined {
  if (amountIn === 0n || reserveIn === 0n || reserveOut === 0n) {
    return undefined;
  }
  const out = (amountIn * reserveOut) / (reserveIn + amountIn);
  return out === 0n ? undefined : out;
}

// The snipe tax a buy pays: the curve's reading, bounded so the buyer keeps at least 1% of the
// input once the fee and the creator tax are taken. Undefined when that bound is below zero, where
// the curve refuses every taxed buy.
function chargedSnipeTaxBps(terms: BuyTerms): bigint | undefined {
  const bound = whole - terms.feeBps - terms.creatorTaxBps - keptBps;
  if (terms.snipeTaxBps === 0n) {
    return 0n;
  }
  if (bound < 0n) {
    return undefined;
  }
  return terms.snipeTaxBps > bound ? bound : terms.snipeTaxBps;
}

/**
 * What a buy of exactly `quoteIn` gets on a Genius.fun curve, to the wei, as the curve's verified
 * code computes it: the fee, the creator tax and the snipe tax each come off the input, rounded
 * down apiece, and the rest buys at the constant product of the reserves. A buy the curve refuses
 * (nothing in, an empty reserve, or nothing out) is undefined. It leaves out the curve's last
 * sellable tokens, which the caller checks.
 */
export function buyOut(terms: BuyTerms, quoteIn: bigint): BuyOutcome | undefined {
  const snipeTaxBps = chargedSnipeTaxBps(terms);
  if (snipeTaxBps === undefined) {
    return undefined;
  }
  const fee = (quoteIn * terms.feeBps) / whole;
  const tax = (quoteIn * terms.creatorTaxBps) / whole;
  const snipeTax = (quoteIn * snipeTaxBps) / whole;
  const tokensOut = productOut(
    quoteIn - fee - tax - snipeTax,
    terms.quoteReserve,
    terms.tokenReserve,
  );
  return tokensOut === undefined ? undefined : { tokensOut, snipeTaxBps, taxPaid: tax + snipeTax };
}

/**
 * What a sale of exactly `tokensIn` gets on a Genius.fun curve, to the wei: the constant product
 * prices the whole input, then the fee and the creator tax come off the proceeds, each rounded
 * down. A sale the curve refuses (nothing in, an empty reserve, or nothing out) is undefined.
 */
export function sellOut(terms: CurveTerms, tokensIn: bigint): SellOutcome | undefined {
  const gross = productOut(tokensIn, terms.tokenReserve, terms.quoteReserve);
  if (gross === undefined) {
    return undefined;
  }
  const fee = (gross * terms.feeBps) / whole;
  const tax = (gross * terms.creatorTaxBps) / whole;
  return { quoteOut: gross - fee - tax, taxPaid: tax };
}
