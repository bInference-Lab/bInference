import { type CardDisplay, cardLineText } from "@binference/i18n";
import { useId } from "react";
import { CardLine } from "../cards/card-line";
import { useText } from "../i18n/console-text";
import type { HeldItem, HoldingSection } from "./portfolio-sections";

// A section's stakes or bridges in transit under their heading, one list item for each; nothing
// when there is none.
function HeldList(props: {
  readonly title: string;
  readonly items: readonly HeldItem[];
  readonly display: CardDisplay;
}): React.JSX.Element | null {
  const id = useId();
  const { items, display } = props;
  if (items.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-col gap-2">
      <h4 id={id} className="text-sm text-muted-foreground">
        {props.title}
      </h4>
      <ul aria-labelledby={id} className="flex flex-col divide-y rounded-lg border text-sm">
        {items.map((item) => (
          <li key={item.key} className="flex flex-col gap-1 px-3 py-2 tabular-nums">
            {item.lines.map((line) => {
              const text = cardLineText(line, display);
              return (
                <p key={text}>
                  <CardLine text={text} />
                </p>
              );
            })}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A section's stakes, then its bridges in transit, each under its heading in the words
 * `/positions` uses: a stake's worth, its unbonding parts with when a claim can take them and
 * what a claim takes now; a bridge's amount, recipient, destination chain and since when.
 */
export function HeldElsewhere(props: {
  readonly section: HoldingSection;
  readonly display: CardDisplay;
}): React.JSX.Element {
  const text = useText();
  const { section, display } = props;
  return (
    <>
      <HeldList
        title={text("console.portfolio.staking")}
        items={section.stakes}
        display={display}
      />
      <HeldList
        title={text("console.portfolio.inTransit")}
        items={section.transits}
        display={display}
      />
    </>
  );
}
