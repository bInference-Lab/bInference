import { type CardDisplay, cardLineText } from "@binference/i18n";
import type { CardLineView, PnlCardView } from "@binference/protocol";
import { CardLine } from "../cards/card-line";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { PaperBadge } from "../screens/screen-state";

// The engine's header lines of a P&L card, and the console's own for each, without the mode: the
// section names it, and the Paper label marks a paper card, as on a waiting card.
const titleKeys: ReadonlyMap<string, string> = new Map([
  ["pnl.header", "console.portfolio.cardTitle"],
  ["pnl.headerClosed", "console.portfolio.cardTitleClosed"],
]);

function titleLine(line: CardLineView): CardLineView {
  return { ...line, key: titleKeys.get(line.key) ?? line.key };
}

/**
 * One position's P&L card as the engine drew it (spec 4, section 3.7): each line through
 * `cardLineText`, the same text Telegram shows, with the Paper label on a paper card.
 */
export function PnlCard(props: {
  readonly card: PnlCardView;
  readonly display: CardDisplay;
}): React.JSX.Element {
  const { card, display } = props;
  const [header, ...rest] = card.lines;
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {header === undefined ? null : (
            <CardLine text={cardLineText(titleLine(header), display)} />
          )}
          {card.paper ? <PaperBadge /> : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1 text-sm">
        {rest.map((line) => {
          const text = cardLineText(line, display);
          return (
            <p key={text}>
              <CardLine text={text} />
            </p>
          );
        })}
      </CardContent>
    </Card>
  );
}
