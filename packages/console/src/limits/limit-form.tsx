import { type LimitField, limitLines, limitUnits } from "@binference/i18n";
import type { AgentView, LimitsView } from "@binference/protocol";
import { useState } from "react";
import { Alert, AlertDescription } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { FailedAlert } from "../connection/failed-alert";
import { useFormatter, useText } from "../i18n/console-text";
import { fieldClass, FormField, TextField } from "../rules/form-field";
import { inputOf, limitChangeOf, unitOf } from "./limit-input";
import { type LimitChange, useLimitChange } from "./use-limit-change";

// The hint under the value: the unit to type it in; an empty allow list allows every token.
function hintKind(field: LimitField): string {
  return field === "allowTokens" ? "allow" : unitOf(field);
}

// What a change did, as `limit/set` answered: applied now, or waits 24 hours with when it applies
// (decision 0111); nothing once a looser one no longer waits in the limits read now, such as after
// a cancel.
function ChangeOutcome(props: {
  readonly view: LimitsView;
  readonly now: LimitsView;
  readonly field: LimitField;
}): React.JSX.Element | null {
  const text = useText();
  const formatter = useFormatter();
  const { view, field } = props;
  const { pending } = view;
  const isWaiting = pending?.changes[field] !== undefined;
  const line = limitLines(isWaiting ? pending.changes : view, { formatter }).find(
    (each) => each.field === field,
  );
  if (line === undefined || (isWaiting && props.now.pending?.changes[field] === undefined)) {
    return null;
  }
  return (
    <output>
      {isWaiting
        ? text("console.limits.waits", {
            name: line.name,
            value: line.value,
            when: formatter.dateTime(pending.effectiveAt),
          })
        : text("console.limits.now", { name: line.name, value: line.value })}
    </output>
  );
}

// The limit picked, by the field `limit/set` names it with, as every surface lists them.
function LimitPicker(props: {
  readonly field: LimitField;
  readonly pick: (field: LimitField) => void;
}): React.JSX.Element {
  const text = useText();
  return (
    <FormField label={text("console.limits.limit")}>
      {({ id }) => (
        <select
          id={id}
          name="limit"
          value={props.field}
          onChange={(event) => {
            const next = limitUnits.find((entry) => entry.field === event.target.value);
            if (next !== undefined) {
              props.pick(next.field);
            }
          }}
          className={fieldClass}
        >
          {limitUnits.map(({ field }) => (
            <option key={field} value={field}>
              {text("limit.name", { field })}
            </option>
          ))}
        </select>
      )}
    </FormField>
  );
}

function useLimitForm(view: LimitsView) {
  const change = useLimitChange(view.agent);
  const [field, setField] = useState<LimitField>("perTradeUsdMicros");
  const [typed, setTyped] = useState(() => inputOf("perTradeUsdMicros", view.perTradeUsdMicros));
  const [isUnread, setUnread] = useState(false);
  const pick = (next: LimitField): void => {
    setField(next);
    setTyped(inputOf(next, view[next]));
    setUnread(false);
    change.reset();
  };
  const submit = (): void => {
    const changes = limitChangeOf(field, typed);
    setUnread(changes === undefined);
    if (changes !== undefined) {
      const asked: LimitChange = { field, changes };
      change.mutate(asked);
    }
  };
  return { change, field, typed, setTyped, isUnread, pick, submit };
}

/**
 * Changes one limit of the agent through `limit/set` (decision 0111): the limit, its new value in
 * the unit it is set in, then what the engine did with it: a stricter value applies at once, a
 * looser one waits 24 hours with when it applies, and a refused one says why in its code's words.
 * A value the limit cannot take is refused before anything is sent. The gas reserve, set in each
 * chain's coin, changes in the terminal only.
 */
export function LimitForm(props: {
  readonly agent: AgentView;
  readonly view: LimitsView;
}): React.JSX.Element {
  const text = useText();
  const form = useLimitForm(props.view);
  const name = text("limit.name", { field: form.field });
  return (
    <form
      aria-label={text("console.limits.changeOf", { name: props.agent.name })}
      className="flex flex-col gap-3 border-t pt-4"
      onSubmit={(event) => {
        event.preventDefault();
        form.submit();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <LimitPicker field={form.field} pick={form.pick} />
        <TextField
          label={text("console.limits.newValue")}
          hint={text("console.limits.hint", { unit: hintKind(form.field) })}
          name="value"
          value={form.typed}
          onChange={form.setTyped}
          inputMode={unitOf(form.field) === "list" ? "text" : "decimal"}
        />
      </div>
      <p className="text-xs text-muted-foreground">{text("console.limits.rule")}</p>
      <div>
        <Button type="submit" disabled={form.change.isPending}>
          {text("console.limits.apply")}
        </Button>
      </div>
      {form.isUnread ? (
        <Alert variant="destructive">
          <AlertDescription>{text("console.limits.badValue", { name })}</AlertDescription>
        </Alert>
      ) : null}
      {form.change.data === undefined ? null : (
        <ChangeOutcome view={form.change.data} now={props.view} field={form.field} />
      )}
      <FailedAlert error={form.change.error} wordsKey="console.limits.failed" />
    </form>
  );
}
