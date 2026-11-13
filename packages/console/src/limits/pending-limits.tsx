import type { PendingLimitsView } from "@binference/protocol";
import type { ReactNode } from "react";
import { Button } from "../components/ui/button";
import { useEngine } from "../connection/engine-context";
import { MessageText, useFormatter, useText } from "../i18n/console-text";
import type { useCancelPending } from "./use-limit-change";

/**
 * The looser limits that wait (decision 0111): when they apply, each at the value it takes then,
 * drawn by `table`, and Cancel the looser limits for a connection with `confirm`, which keeps the
 * limits in effect.
 */
export function PendingLimits(props: {
  readonly pending: PendingLimitsView;
  readonly table: ReactNode;
  readonly cancel: ReturnType<typeof useCancelPending>;
}): React.JSX.Element {
  const text = useText();
  const formatter = useFormatter();
  const { ready } = useEngine();
  const { cancel } = props;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">
        <MessageText
          text={text("console.limits.pending", {
            when: formatter.dateTime(props.pending.effectiveAt),
          })}
        />
      </p>
      {props.table}
      {ready.scopes.includes("confirm") ? (
        <div>
          <Button variant="outline" disabled={cancel.isPending} onClick={() => cancel.mutate()}>
            {text("console.limits.cancelPending")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
