import type { AgentView } from "@binference/protocol";
import { useText } from "../i18n/console-text";
import { fieldClass, FormField, TextField } from "./form-field";
import type { RuleFields, SizeUnit } from "./rule-request";

/** A change of some of the form's fields. */
export type SetFields = (change: Partial<RuleFields>) => void;

const sizeUnits: readonly SizeUnit[] = ["usd", "amount", "percent"];

/** The agent a new rule is for, when the install holds more than one. */
export function AgentField(props: {
  readonly agents: readonly AgentView[];
  readonly picked: AgentView;
  readonly pick: (agent: AgentView) => void;
}): React.JSX.Element | null {
  const text = useText();
  if (props.agents.length < 2) {
    return null;
  }
  return (
    <FormField label={text("console.rules.field.agent")}>
      {({ id }) => (
        <select
          id={id}
          name="agent"
          value={props.picked.agent}
          onChange={(event) => {
            const next = props.agents.find((agent) => agent.agent === event.target.value);
            if (next !== undefined) {
              props.pick(next);
            }
          }}
          className={fieldClass}
        >
          {props.agents.map((agent) => (
            <option key={agent.agent} value={agent.agent}>
              {agent.name}
            </option>
          ))}
        </select>
      )}
    </FormField>
  );
}

/** Whether each alert buys or sells, the token, and what a buy spends. */
export function TradeFields(props: {
  readonly fields: RuleFields;
  readonly set: SetFields;
  readonly token: string;
  readonly setToken: (token: string) => void;
  readonly spend: string;
  readonly setSpend: (spend: string) => void;
}): React.JSX.Element {
  const text = useText();
  const { fields, set } = props;
  return (
    <>
      <FormField label={text("console.rules.field.side")}>
        {({ id }) => (
          <select
            id={id}
            name="side"
            value={fields.side}
            onChange={(event) => set({ side: event.target.value === "sell" ? "sell" : "buy" })}
            className={fieldClass}
          >
            <option value="buy">{text("console.rules.side", { side: "buy" })}</option>
            <option value="sell">{text("console.rules.side", { side: "sell" })}</option>
          </select>
        )}
      </FormField>
      <TextField
        label={text("console.rules.field.token")}
        hint={text("console.rules.field.tokenHint")}
        name="token"
        value={props.token}
        onChange={props.setToken}
        isRequired
      />
      {fields.side === "buy" ? (
        <TextField
          label={text("console.rules.field.spend")}
          hint={text("console.rules.field.spendHint")}
          name="spend"
          value={props.spend}
          onChange={props.setSpend}
        />
      ) : null}
    </>
  );
}

/** How each fill is sized, and its size. */
export function SizeFields(props: {
  readonly fields: RuleFields;
  readonly set: SetFields;
}): React.JSX.Element {
  const text = useText();
  const { fields, set } = props;
  return (
    <>
      <FormField label={text("console.rules.field.unit")}>
        {({ id }) => (
          <select
            id={id}
            name="sizeUnit"
            value={fields.sizeUnit}
            onChange={(event) =>
              set({ sizeUnit: sizeUnits.find((unit) => unit === event.target.value) ?? "usd" })
            }
            className={fieldClass}
          >
            {sizeUnits.map((unit) => (
              <option key={unit} value={unit}>
                {text("console.rules.unit", { unit })}
              </option>
            ))}
          </select>
        )}
      </FormField>
      <TextField
        label={text("console.rules.field.size")}
        hint={text("console.rules.field.sizeHint", { unit: fields.sizeUnit })}
        name="size"
        inputMode="decimal"
        value={fields.size}
        onChange={(size) => set({ size })}
        isRequired
      />
    </>
  );
}

type BoundKey = "worstPrice" | "slippage" | "maxFills" | "rate" | "days";

// Each bound the form takes beside the size, its kind of number, and what it holds when empty.
const bounds: readonly (readonly [BoundKey, "decimal" | "numeric", string])[] = [
  ["worstPrice", "decimal", "console.rules.placeholder.none"],
  ["slippage", "decimal", "console.rules.placeholder.slippage"],
  ["maxFills", "numeric", "console.rules.placeholder.none"],
  ["rate", "numeric", "console.rules.placeholder.rate"],
  ["days", "numeric", "console.rules.placeholder.days"],
];

/** The bounds besides the size, each optional: the engine fills its default. */
export function BoundFields(props: {
  readonly fields: RuleFields;
  readonly set: SetFields;
}): React.JSX.Element {
  const text = useText();
  return (
    <>
      {bounds.map(([key, inputMode, placeholder]) => (
        <TextField
          key={key}
          label={text(`console.rules.field.${key}`)}
          name={key}
          inputMode={inputMode}
          placeholder={text(placeholder)}
          value={props.fields[key]}
          onChange={(value) => props.set({ [key]: value })}
        />
      ))}
    </>
  );
}
