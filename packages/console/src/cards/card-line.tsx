import {
  CircleCheckIcon,
  CircleDotIcon,
  CircleXIcon,
  ClockIcon,
  FlaskConicalIcon,
  type LucideIcon,
  TriangleAlertIcon,
  ZapIcon,
} from "lucide-react";
import { MessageText, useText } from "../i18n/console-text";

/** One status icon of spec 4: the line icon the console draws for it, its name and its color. */
interface LineIcon {
  readonly Icon: LucideIcon;
  readonly label: string;
  readonly tone: string;
}

const variation = String.fromCodePoint(0xfe0f);

// Spec 4's status icons, which Telegram shows as emoji, by code point: the console draws each as a
// thin line icon, as the brand's flat look asks.
const iconPoints: readonly (readonly [number, LineIcon])[] = [
  [0x1f7e1, { Icon: ClockIcon, label: "console.icon.waiting", tone: "text-gold" }],
  [0x2705, { Icon: CircleCheckIcon, label: "console.icon.passed", tone: "text-gain" }],
  [0x274c, { Icon: CircleXIcon, label: "console.icon.refused", tone: "text-destructive" }],
  [0x26a0, { Icon: TriangleAlertIcon, label: "console.icon.warning", tone: "text-gold" }],
  [0x1f9ea, { Icon: FlaskConicalIcon, label: "console.icon.paper", tone: "text-gold" }],
  [0x1f534, { Icon: CircleDotIcon, label: "console.icon.live", tone: "text-destructive" }],
  [0x1f7e2, { Icon: CircleDotIcon, label: "console.icon.on", tone: "text-gain" }],
  [0x26a1, { Icon: ZapIcon, label: "console.icon.auto", tone: "text-gold" }],
];

const icons: ReadonlyMap<string, LineIcon> = new Map(
  iconPoints.map(([point, icon]) => [String.fromCodePoint(point), icon]),
);

const iconPattern = new RegExp(`(${[...icons.keys()].join("|")})${variation}?`, "u");

/** One piece of a line: plain text or a status icon, keyed by where it starts in the line. */
interface LinePiece {
  readonly start: number;
  readonly piece: string | LineIcon;
}

/** A line's text in pieces: plain text, and the status icons between it, in order. */
function linePieces(text: string): readonly LinePiece[] {
  const parts = text.split(iconPattern).filter((part) => part !== "");
  const starts = parts.map((_part, index) =>
    parts.slice(0, index).reduce((sum, part) => sum + part.length, 0),
  );
  return parts.map((part, index) => ({
    start: starts[index] ?? 0,
    piece: icons.get(part) ?? part,
  }));
}

/** How a line's plain pieces are drawn: as they are, or with their `code` spans as code. */
type PieceStyle = "plain" | "message";

function LinePieces(props: {
  readonly text: string;
  readonly drawn: PieceStyle;
}): React.JSX.Element {
  const text = useText();
  return (
    <>
      {linePieces(props.text).map(({ start, piece }) => {
        if (typeof piece === "string") {
          return (
            <span key={start}>
              {props.drawn === "message" ? <MessageText text={piece} /> : piece}
            </span>
          );
        }
        const { Icon, label, tone } = piece;
        return (
          <span key={start}>
            <Icon
              aria-hidden
              strokeWidth={1.5}
              className={`inline size-[1.1em] align-[-0.2em] ${tone}`}
            />
            <span className="sr-only">{text(label)}</span>
          </span>
        );
      })}
    </>
  );
}

/**
 * One card line as the console draws it: the text Telegram shows, with each status icon of spec 4
 * drawn as a thin line icon, its name read to screen readers only. Telegram keeps its emoji.
 */
export function CardLine(props: { readonly text: string }): React.JSX.Element {
  return <LinePieces text={props.text} drawn="plain" />;
}

/**
 * One line of a message of binference's own, such as a notice or a status line, drawn as a card
 * line is, with each `code` span, such as `binference unlock`, shown as code.
 */
export function MessageLine(props: { readonly text: string }): React.JSX.Element {
  return <LinePieces text={props.text} drawn="message" />;
}
