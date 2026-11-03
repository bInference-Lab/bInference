import type { AgentView } from "@binference/protocol";
import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { Alert, AlertDescription } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "../components/ui/card";
import { useEngine } from "../connection/engine-context";
import { errorWords } from "../connection/error-words";
import { MessageText, useText, type Words } from "../i18n/console-text";
import { TextField } from "./form-field";
import { AgentField, BoundFields, SizeFields, TradeFields } from "./rule-fields";
import type { RuleFields } from "./rule-request";
import { ShownUrl } from "./shown-url";
import { type SubmitOutcome, useRuleSubmit } from "./use-rule-submit";

const emptyFields: RuleFields = {
  name: "",
  side: "buy",
  sizeUnit: "usd",
  size: "",
  worstPrice: "",
  slippage: "",
  maxFills: "",
  rate: "",
  days: "",
};

// What the form says of a submit that stored nothing; `undefined` for one that made a rule.
function refusalOf(text: Words, outcome: SubmitOutcome | undefined): string | undefined {
  if (outcome?.kind === "problem") {
    return text("console.rules.problem", { field: outcome.problem });
  }
  if (outcome?.kind === "noWallet") {
    return text("console.rules.noWallet");
  }
  if (outcome?.kind !== "token") {
    return undefined;
  }
  return outcome.matches === ""
    ? text("console.rules.unknownToken", { token: outcome.token })
    : text("console.rules.ambiguousToken", { token: outcome.token, matches: outcome.matches });
}

function Refusal(props: { readonly text: string | undefined }): React.JSX.Element | null {
  return props.text === undefined ? null : (
    <Alert variant="destructive">
      <AlertDescription>
        <MessageText text={props.text} />
      </AlertDescription>
    </Alert>
  );
}

// The form's state: the agent picked, the fields, and the token and spend as typed.
function useRuleFields(agents: readonly AgentView[]) {
  const [first] = agents;
  const [agentId, setAgentId] = useState(first?.agent);
  const [fields, setFields] = useState(emptyFields);
  const [token, setToken] = useState("");
  const [spend, setSpend] = useState("");
  return {
    picked: agents.find((agent) => agent.agent === agentId) ?? first,
    pick: (agent: AgentView) => setAgentId(agent.agent),
    fields,
    set: (change: Partial<RuleFields>) => setFields((now) => ({ ...now, ...change })),
    trade: { token, setToken, spend, setSpend },
    clear: () => {
      setFields(emptyFields);
      setToken("");
      setSpend("");
    },
  };
}

type RuleFormState = ReturnType<typeof useRuleFields>;

// The fields of the form, two to a row where the page is wide enough.
function FieldGrid(props: {
  readonly agents: readonly AgentView[];
  readonly form: RuleFormState;
}): React.JSX.Element {
  const text = useText();
  const { picked, fields, set, trade } = props.form;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {picked === undefined ? null : (
        <AgentField agents={props.agents} picked={picked} pick={props.form.pick} />
      )}
      <TextField
        label={text("console.rules.field.name")}
        hint={text("console.rules.field.nameHint")}
        name="name"
        value={fields.name}
        onChange={(name) => set({ name })}
        isRequired
      />
      <TradeFields fields={fields} set={set} {...trade} />
      <SizeFields fields={fields} set={set} />
      <BoundFields fields={fields} set={set} />
    </div>
  );
}

function CreateButton(props: { readonly isPending: boolean }): React.JSX.Element {
  const text = useText();
  const { ready } = useEngine();
  return ready.scopes.includes("admin") ? (
    <Button type="submit" disabled={props.isPending}>
      <PlusIcon data-icon="inline-start" strokeWidth={1.5} aria-hidden />
      {text("console.rules.create")}
    </Button>
  ) : (
    <p className="text-sm text-muted-foreground">{text("console.rules.noAdmin")}</p>
  );
}

/**
 * The form that makes an alert rule (decision 0299): its name, what each alert trades and its
 * size, and its other bounds. `webhookRule/create` answers the rule's URL once, which shows above
 * the form until the owner says they copied it, and the form empties for the next rule; the rule's
 * card then waits in its list. Only a
 * connection with `admin` makes one.
 */
export function RuleForm(props: { readonly agents: readonly AgentView[] }): React.JSX.Element {
  const text = useText();
  const form = useRuleFields(props.agents);
  const submit = useRuleSubmit();
  const { picked, fields, trade } = form;
  const outcome = submit.data;
  const failed = submit.error === null ? undefined : errorWords(text, submit.error);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{text("console.rules.new")}</CardTitle>
      </CardHeader>
      <form
        aria-label={text("console.rules.new")}
        onSubmit={(event) => {
          event.preventDefault();
          if (picked !== undefined) {
            const asked = { agent: picked, fields, token: trade.token, spend: trade.spend };
            submit.mutate(asked, {
              onSuccess: (made) => (made.kind === "created" ? form.clear() : undefined),
            });
          }
        }}
        className="flex flex-col gap-4"
      >
        <CardContent className="flex flex-col gap-4">
          {outcome?.kind === "created" ? (
            <ShownUrl url={outcome.created.url} onDone={() => submit.reset()} />
          ) : null}
          <FieldGrid agents={props.agents} form={form} />
          <Refusal text={refusalOf(text, outcome)} />
          <Refusal
            text={
              failed === undefined ? undefined : text("console.rules.failed", { reason: failed })
            }
          />
        </CardContent>
        <CardFooter className="flex flex-wrap items-center gap-2">
          <CreateButton isPending={submit.isPending} />
        </CardFooter>
      </form>
    </Card>
  );
}
