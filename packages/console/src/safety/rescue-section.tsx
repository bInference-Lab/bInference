import { addressPartOf } from "@binference/i18n";
import { LifeBuoyIcon } from "lucide-react";
import { useId } from "react";
import { CardGroup } from "../cards/card-group";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "../components/ui/card";
import { useEngine } from "../connection/engine-context";
import { FailedAlert } from "../connection/failed-alert";
import { MessageText, useFormatter, useText } from "../i18n/console-text";
import { useRescue } from "./use-brakes";
import type { SafetyStatus } from "./use-safety-status";

// The rescue address in effect, whole, and a new one that waits with when it takes effect.
function RescueAddress(props: { readonly status: SafetyStatus }): React.JSX.Element {
  const text = useText();
  const formatter = useFormatter();
  const { rescueAddress, pendingRescueAddress, pendingRescueAt } = props.status;
  return (
    <>
      <p className="break-words">
        <MessageText
          text={
            rescueAddress === undefined
              ? text("console.safety.noRescueAddress")
              : text("console.safety.rescueAddress", { address: addressPartOf(rescueAddress) })
          }
        />
      </p>
      {pendingRescueAddress === undefined || pendingRescueAt === undefined ? null : (
        <p className="break-words">
          <MessageText
            text={text("console.safety.pendingRescue", {
              address: addressPartOf(pendingRescueAddress),
              when: formatter.dateTime(pendingRescueAt),
            })}
          />
        </p>
      )}
    </>
  );
}

/**
 * The rescue (decision 0044): what it moves, the rescue address in effect and a new one that
 * waits, the rescue that has not ended, and Open the rescue card, with `confirm`, which opens its
 * card through `safety/rescue`, or answers the rescue under way (decision 0125). A tap on the
 * card, here or on any surface, confirms it.
 */
export function RescueSection(props: { readonly status: SafetyStatus }): React.JSX.Element {
  const text = useText();
  const id = useId();
  const { ready } = useEngine();
  const rescue = useRescue();
  const underWay = props.status.rescue;
  const canRescue = ready.scopes.includes("confirm") && props.status.rescueAddress !== undefined;
  return (
    <section aria-labelledby={id}>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2 id={id}>{text("console.safety.rescueTitle")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <p className="text-muted-foreground">{text("console.safety.rescueAbout")}</p>
          <RescueAddress status={props.status} />
          {underWay === undefined ? null : (
            <p>{text("console.safety.rescueUnderWay", { state: underWay.state })}</p>
          )}
          {rescue.isSuccess && underWay?.state === "awaiting_confirmation" ? (
            <output>{text("console.safety.rescueOpened")}</output>
          ) : null}
          <FailedAlert error={rescue.error} wordsKey="console.safety.failed" />
          <CardGroup
            label={text("console.safety.rescueCard")}
            matches={(intent) => intent.kind === "rescue"}
          />
        </CardContent>
        {canRescue ? (
          <CardFooter>
            <Button disabled={rescue.isPending} onClick={() => rescue.mutate()}>
              <LifeBuoyIcon data-icon="inline-start" strokeWidth={1.5} aria-hidden />
              {text("console.safety.openRescue")}
            </Button>
          </CardFooter>
        ) : null}
      </Card>
    </section>
  );
}
