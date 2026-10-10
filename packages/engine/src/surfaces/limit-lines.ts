import { type ChainRegistry, isChainRef } from "@binference/chain";
import { isBps } from "@binference/core";
import type { Formatter } from "@binference/i18n";
import type { LimitChanges, LimitSettings } from "@binference/protocol";

/** The unit a limit is set in, which decides how it reads and how a person types it. */
export type LimitUnit = "usd" | "bps" | "seconds" | "days" | "healthFactor" | "list";

/** A limit other than the gas reserve, which each chain sets on its own. */
export type LimitField = Exclude<keyof LimitSettings, "gasReserve">;

/** A limit and the unit it is set in. */
export interface LimitUnitOf {
  readonly field: LimitField;
  readonly unit: LimitUnit;
}

/** Every limit but the gas reserve, in the order every surface lists them, with its unit. */
export const limitUnits: readonly LimitUnitOf[] = [
  { field: "perTradeUsdMicros", unit: "usd" },
  { field: "rollingDayUsdMicros", unit: "usd" },
  { field: "slippageRegistryBps", unit: "bps" },
  { field: "slippageOtherBps", unit: "bps" },
  { field: "priceImpactBps", unit: "bps" },
  { field: "taxBps", unit: "bps" },
  { field: "liquidityFloorUsdMicros", unit: "usd" },
  { field: "minHealthFactorBps", unit: "healthFactor" },
  { field: "venues", unit: "list" },
  { field: "allowTokens", unit: "list" },
  { field: "denyTokens", unit: "list" },
  { field: "modelBudgetUsdMicros", unit: "usd" },
  { field: "cardTradeExpirySeconds", unit: "seconds" },
  { field: "cardOtherExpirySeconds", unit: "seconds" },
  { field: "requoteAfterSeconds", unit: "seconds" },
  { field: "requoteToleranceBps", unit: "bps" },
  { field: "orderExpiryDays", unit: "days" },
  { field: "copyPerBuyUsdMicros", unit: "usd" },
  { field: "copyPerLeaderDayUsdMicros", unit: "usd" },
];

/** What limits are read with: the owner's formatter, and the chains a gas reserve names. */
export interface LimitDisplay {
  readonly formatter: Formatter;
  readonly chains: ChainRegistry;
}

/** A limit's name and value as a person reads them, in the owner's language. */
interface LimitText {
  readonly name: string;
  readonly value: string;
}

/** One limit other than the gas reserve, as a person reads it. */
export interface SettingLine extends LimitText {
  readonly field: LimitField;
}

/** One chain's gas reserve, as a person reads it. */
export interface GasReserveLine extends LimitText {
  readonly field: "gasReserve";
  /** The chain whose wallets keep the reserve. */
  readonly chain: string;
}

/** One limit as a person reads it: its name and its value, in the owner's language. */
export type LimitLine = SettingLine | GasReserveLine;

type LimitValue = LimitChanges[LimitField];

// Health factors are basis points of one: 15000 reads 1.5.
const healthFactorDecimals = 4;

function valueText(entry: LimitUnitOf, value: NonNullable<LimitValue>, display: LimitDisplay) {
  const { formatter } = display;
  if (typeof value === "bigint") {
    return formatter.usd(value);
  }
  if (typeof value === "object") {
    const empty = entry.field === "allowTokens" ? "limit.allTokens" : "limit.none";
    return value.length === 0 ? formatter.message(empty) : value.join(", ");
  }
  if (entry.unit === "seconds" || entry.unit === "days") {
    return formatter.message(`limit.${entry.unit}`, { count: value });
  }
  if (entry.unit === "healthFactor") {
    return formatter.tokenAmount(BigInt(value), healthFactorDecimals);
  }
  return isBps(value) ? formatter.percent(value) : String(value);
}

function gasText(chain: string, base: bigint, display: LimitDisplay): string {
  const { formatter } = display;
  const served = isChainRef(chain) ? display.chains.get(chain) : undefined;
  if (served?.ok !== true) {
    return formatter.message("limit.gasBase", { amount: String(base), chain });
  }
  const { definition } = served.value;
  const { decimals, symbol } = definition.nativeAsset;
  const amount = `${formatter.tokenAmount(base, decimals)} ${symbol}`;
  return formatter.message("limit.gas", { amount, chain: definition.name });
}

/**
 * Each limit `changes` holds as a line in the owner's language (`limit.name` and the value in its
 * unit), in the order of {@link limitUnits}, then each chain's gas reserve. A limit `changes`
 * leaves out has no line. The CLI and Telegram draw an agent's limits through it.
 */
export function limitLines(changes: LimitChanges, display: LimitDisplay): readonly LimitLine[] {
  const nameOf = (field: string): string => display.formatter.message("limit.name", { field });
  const lines = limitUnits.flatMap((entry): readonly LimitLine[] => {
    const value = changes[entry.field];
    return value === undefined
      ? []
      : [
          {
            field: entry.field,
            name: nameOf(entry.field),
            value: valueText(entry, value, display),
          },
        ];
  });
  const gas = Object.entries(changes.gasReserve ?? {}).map(
    ([chain, base]: readonly [string, bigint]): LimitLine => ({
      field: "gasReserve",
      chain,
      name: nameOf("gasReserve"),
      value: gasText(chain, base, display),
    }),
  );
  return [...lines, ...gas];
}
