import { err, ok, type Result } from "@binference/core";
import { keepBounded } from "./keep-bounded.js";

/** Bytes whose parts are arriving, in order, until `untilMs`. */
export interface Arriving {
  readonly bytes: Uint8Array;
  readonly received: number;
  readonly untilMs: number;
}

/** One part as the runtime sends it: where it starts, the whole's size, and its bytes in base64. */
interface Part {
  readonly offset: number;
  readonly total: number;
  readonly data: string;
}

/** How long an arrival may take and how many arrive at once, by the clock's time now. */
interface ArrivalBounds {
  readonly nowMs: number;
  readonly arrivingMs: number;
  readonly mostArriving: number;
}

/**
 * Adds a part to the bytes arriving under `key`: a part at offset 0, or one after the arrival ran
 * past its time, starts them again. A part out of order or past the end drops them as
 * `protocol.bad_args`. Bytes still arriving stay in `arriving`, at most `mostArriving`; whole ones
 * leave it.
 */
export function addPart(
  arriving: Map<string, Arriving>,
  arrival: { readonly key: string; readonly part: Part },
  bounds: ArrivalBounds,
): Result<Arriving, "protocol.bad_args"> {
  const { key, part } = arrival;
  const before = arriving.get(key);
  const current =
    before === undefined || before.untilMs <= bounds.nowMs || part.offset === 0
      ? {
          bytes: new Uint8Array(part.total),
          received: 0,
          untilMs: bounds.nowMs + bounds.arrivingMs,
        }
      : before;
  const bytes = Buffer.from(part.data, "base64");
  const fits =
    current.bytes.byteLength === part.total &&
    part.offset === current.received &&
    part.offset + bytes.byteLength <= part.total;
  if (!fits) {
    arriving.delete(key);
    return err("protocol.bad_args");
  }
  current.bytes.set(bytes, part.offset);
  const next = { ...current, received: current.received + bytes.byteLength };
  if (next.received < part.total) {
    keepBounded(arriving, [key, next], bounds.mostArriving);
  } else {
    arriving.delete(key);
  }
  return ok(next);
}
