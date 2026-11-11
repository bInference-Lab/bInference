import { type QrModules, qrModules } from "@binference/qr";
import { useId, useMemo } from "react";
import { useText } from "../i18n/console-text";

/** A run of dark modules in one row: where it starts and how many modules long it is. */
type Run = readonly [start: number, length: number];

// The dark modules of a row, each run of them one rectangle.
function runsOf(row: readonly boolean[]): readonly Run[] {
  const starts = row.flatMap((isDark, x) => (isDark && row[x - 1] !== true ? [x] : []));
  return starts.map((start) => {
    const end = row.indexOf(false, start);
    return [start, (end === -1 ? row.length : end) - start];
  });
}

// One path of every dark module, a unit square each, so the drawing scales with no gap.
function darkPath(modules: QrModules): string {
  return modules
    .flatMap((row, y) =>
      runsOf(row).map(
        ([x, length]) => `M${String(x)} ${String(y)}h${String(length)}v1h-${String(length)}z`,
      ),
    )
    .join("");
}

/**
 * The QR code of an address the engine read from custody (decision 0380), drawn as SVG from the
 * module grid `@binference/qr` makes, its quiet zone included: ink on white in both themes, since
 * scanners read no other, and named to screen readers by the address it holds.
 */
export function AddressCode(props: { readonly address: string }): React.JSX.Element {
  const text = useText();
  const { address } = props;
  const caption = useId();
  const modules = useMemo(() => qrModules(address), [address]);
  const size = String(modules.length);
  return (
    <figure aria-labelledby={caption} className="shrink-0">
      <svg
        aria-hidden="true"
        viewBox={`0 0 ${size} ${size}`}
        shapeRendering="crispEdges"
        className="size-44 rounded-md"
      >
        <rect width={size} height={size} fill="var(--qr-light)" />
        <path d={darkPath(modules)} fill="var(--qr-dark)" />
      </svg>
      <figcaption id={caption} className="sr-only">
        {text("console.chat.depositCode", { address })}
      </figcaption>
    </figure>
  );
}
