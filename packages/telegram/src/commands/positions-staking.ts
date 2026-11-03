import type { ChainRef, ChainRegistry } from "@binference/chain";
import { cardLineText, stakeLines, transitLine } from "@binference/i18n";
import type { PortfolioView } from "@binference/protocol";
import type { CommandContext } from "./command-context.js";

// A chain as a reply names it: the registry's name, or its reference when the registry lacks it.
function chainName(chains: ChainRegistry, chain: ChainRef): string {
  const registered = chains.get(chain);
  return registered.ok ? registered.value.definition.name : chain;
}

// A heading and its lines as one block, or none without a line.
function blockOf(heading: string, lines: readonly string[]): readonly string[] {
  return lines.length === 0 ? [] : [[heading, ...lines].join("\n")];
}

/**
 * One mode's staking and bridges in transit under `/positions` (spec 4, section 5), from
 * `portfolio/get`: each stake's units as the coin they are worth and their dollars, its unbonding
 * parts and what a claim takes now, then each bridge in transit with its recipient, destination
 * chain and since when. Bridges are live only, so a paper mode shows none. Each is one block,
 * none when it holds nothing.
 */
export function stakingBlocks(
  context: CommandContext,
  view: PortfolioView,
  mode: "paper" | "live",
): readonly string[] {
  const isPaper = mode === "paper";
  const display = { formatter: context.formatter, assets: view.assets };
  const stakes = (view.staking ?? []).filter((stake) => stake.paper === isPaper);
  const transits = isPaper ? [] : (view.inTransit ?? []);
  return [
    ...blockOf(
      context.words("cmd.positions.staking"),
      stakes.flatMap((stake) => stakeLines(view, stake)).map((line) => cardLineText(line, display)),
    ),
    ...blockOf(
      context.words("cmd.positions.inTransit"),
      transits.map((transit) =>
        cardLineText(
          transitLine(view, transit, chainName(context.chains, transit.toChain)),
          display,
        ),
      ),
    ),
  ];
}
