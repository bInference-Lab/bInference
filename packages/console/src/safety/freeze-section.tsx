import type { AgentView } from "@binference/protocol";
import { useId, useState } from "react";
import { CardGroup } from "../cards/card-group";
import { usePendingIntents } from "../cards/use-pending-intents";
import { Alert, AlertDescription } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { useEngine } from "../connection/engine-context";
import { FailedAlert } from "../connection/failed-alert";
import { MessageText, useFormatter, useText } from "../i18n/console-text";
import { AgentBrakes, type AgentBrakeActions } from "./agent-brakes";
import { FreezeAsk } from "./freeze-ask";
import { type BrakeScope, useFreeze, useUnfreeze } from "./use-brakes";
import type { SafetyStatus } from "./use-safety-status";

// What the install's freeze reads as: every agent frozen since when, nothing frozen, or neither
// when only some agents are, which their rows show.
function InstallState(props: { readonly status: SafetyStatus }): React.JSX.Element | null {
  const text = useText();
  const formatter = useFormatter();
  const { status } = props;
  if (status.frozenAt !== undefined) {
    const when = formatter.dateTime(status.frozenAt);
    return <p>{text("console.safety.installFrozen", { when })}</p>;
  }
  return status.frozen ? null : (
    <p className="text-muted-foreground">{text("console.safety.calm")}</p>
  );
}

// The latest brake's outcome: when the freeze took effect, the unfreeze card it opened while that
// card waits, or that nothing was frozen.
function BrakeOutcome(props: {
  readonly freeze: ReturnType<typeof useFreeze>;
  readonly unfreeze: ReturnType<typeof useUnfreeze>;
}): React.JSX.Element | null {
  const text = useText();
  const formatter = useFormatter();
  const waiting = usePendingIntents().data ?? [];
  const { freeze, unfreeze } = props;
  if (freeze.data !== undefined) {
    const when = formatter.dateTime(freeze.data.frozenAt);
    return <output>{text("console.safety.frozen", { when })}</output>;
  }
  const opened = unfreeze.data?.intent;
  if (unfreeze.data !== undefined && opened === undefined) {
    return <output>{text("console.safety.unfreezeNothing")}</output>;
  }
  return waiting.some(({ intent }) => intent === opened) ? (
    <output>{text("console.safety.unfreezeOpened")}</output>
  ) : null;
}

// Freeze every agent, with `confirm`, and Unfreeze every agent while something is frozen, with
// `loosen`; neither while the freeze is asked once more.
function InstallButtons(props: {
  readonly status: SafetyStatus;
  readonly actions: AgentBrakeActions;
}): React.JSX.Element {
  const text = useText();
  const { status, actions } = props;
  const { freeze, unfreeze } = actions;
  const isFrozen = status.frozenAt !== undefined || (status.agents?.length ?? 0) > 0;
  return (
    <div className="flex flex-wrap gap-2">
      {freeze === undefined || status.frozenAt !== undefined ? null : (
        <Button variant="destructive" disabled={actions.isBusy} onClick={() => freeze({})}>
          {text("console.safety.freezeAll")}
        </Button>
      )}
      {unfreeze === undefined || !isFrozen ? null : (
        <Button variant="outline" disabled={actions.isBusy} onClick={() => unfreeze({})}>
          {text("console.safety.unfreezeAll")}
        </Button>
      )}
    </div>
  );
}

// The brakes this connection may use: a freeze with `confirm`, asked once more first; an unfreeze
// with `loosen`, never while the breaker holds (decision 0441).
function useBrakeActions(status: SafetyStatus) {
  const { ready } = useEngine();
  const freeze = useFreeze();
  const unfreeze = useUnfreeze();
  const [asking, ask] = useState<BrakeScope | undefined>(undefined);
  const canUnfreeze = ready.scopes.includes("loosen") && status.breaker === undefined;
  const actions: AgentBrakeActions = {
    isBusy: freeze.isPending || unfreeze.isPending,
    ...(ready.scopes.includes("confirm") ? { freeze: ask } : {}),
    ...(canUnfreeze
      ? {
          unfreeze: (scope: BrakeScope) => {
            freeze.reset();
            unfreeze.mutate(scope);
          },
        }
      : {}),
  };
  const onFreeze = (): void => {
    ask(undefined);
    unfreeze.reset();
    if (asking !== undefined) {
      freeze.mutate(asking);
    }
  };
  return { freeze, unfreeze, actions, asking, onFreeze, onKeep: () => ask(undefined) };
}

/**
 * The freeze (ARCHITECTURE.md section 11): the install's freeze and each agent's, Freeze every
 * agent and Freeze for one, each asked once more in the page and then at once through
 * `safety/freeze`; and Unfreeze, which opens the unfreeze card through `safety/unfreeze` that a
 * tap confirms, here or on any surface (decision 0128). While bInference's breaker holds, its
 * words show in place of every Unfreeze (decision 0441).
 */
export function FreezeSection(props: {
  readonly status: SafetyStatus;
  readonly agents: readonly AgentView[];
}): React.JSX.Element {
  const text = useText();
  const id = useId();
  const { status } = props;
  const brakes = useBrakeActions(status);
  return (
    <section aria-labelledby={id}>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2 id={id}>{text("console.safety.freezeTitle")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <InstallState status={status} />
          {status.breaker === undefined ? null : (
            <Alert>
              <AlertDescription>
                <MessageText text={text("error.safety.breaker")} />
              </AlertDescription>
            </Alert>
          )}
          <AgentBrakes agents={props.agents} status={status} actions={brakes.actions} />
          {brakes.asking === undefined ? (
            <InstallButtons status={status} actions={brakes.actions} />
          ) : (
            <FreezeAsk scope={brakes.asking} onFreeze={brakes.onFreeze} onKeep={brakes.onKeep} />
          )}
          <BrakeOutcome freeze={brakes.freeze} unfreeze={brakes.unfreeze} />
          <FailedAlert
            error={brakes.freeze.error ?? brakes.unfreeze.error}
            wordsKey="console.safety.failed"
          />
          <CardGroup
            label={text("console.safety.unfreezeCard")}
            matches={(intent) => intent.kind === "unfreeze"}
          />
        </CardContent>
      </Card>
    </section>
  );
}
