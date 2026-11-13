import { useId } from "react";
import { Button } from "../components/ui/button";
import { useText } from "../i18n/console-text";
import type { BrakeScope } from "./use-brakes";

/**
 * The freeze asked once more in the page, in words that name what it cancels and pauses at once:
 * Freeze now freezes, Keep trading leaves everything as it is.
 */
export function FreezeAsk(props: {
  readonly scope: BrakeScope;
  readonly onFreeze: () => void;
  readonly onKeep: () => void;
}): React.JSX.Element {
  const text = useText();
  const id = useId();
  const { name } = props.scope;
  return (
    <section
      aria-labelledby={id}
      className="flex flex-wrap items-center justify-end gap-2 rounded-lg border px-3 py-2 text-sm"
    >
      <p id={id} className="mr-auto">
        {text("console.safety.freezeAsk", {
          scope: name === undefined ? "all" : "agent",
          name: name ?? "",
        })}
      </p>
      <Button variant="outline" size="sm" onClick={props.onKeep}>
        {text("console.safety.keep")}
      </Button>
      <Button variant="destructive" size="sm" onClick={props.onFreeze}>
        {text("console.safety.freezeConfirm")}
      </Button>
    </section>
  );
}
