import { displayOutsideText } from "@binference/i18n";
import type { ProtocolId } from "@binference/protocol";
import { useId, useState } from "react";
import { Button } from "../components/ui/button";
import { errorWords } from "../connection/error-words";
import { useFormatter, useText } from "../i18n/console-text";
import { type CredentialRequestView, useCredentialRequest } from "./use-credential-request";

const inputClass =
  "w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

const shown = (text: string): string => displayOutsideText(text, Number.POSITIVE_INFINITY);

// The hosts as the owner edits them: one per line or separated by commas, in lower case.
function hostsOf(text: string): readonly string[] {
  return text
    .split(/[\s,]+/)
    .map((host) => host.trim().toLowerCase())
    .filter((host) => host !== "");
}

function RequestLines(props: {
  readonly view: CredentialRequestView;
  readonly agentName: string;
}): React.JSX.Element {
  const text = useText();
  const formatter = useFormatter();
  const { view } = props;
  return (
    <>
      <p className="font-medium">
        {text("console.credential.header", { agent: props.agentName, name: view.name })}
      </p>
      {view.reason === undefined ? null : <p className="break-words">{shown(view.reason)}</p>}
      {view.updatedAt === undefined ? null : (
        <p className="text-xs text-muted-foreground">
          {text("console.credential.replaces", { when: formatter.dateTime(view.updatedAt) })}
        </p>
      )}
    </>
  );
}

/** A labeled field of the card: the masked value, or the hosts. */
function Field(props: {
  readonly label: string;
  readonly children: (id: string) => React.ReactNode;
}): React.JSX.Element {
  const id = useId();
  return (
    <>
      <label htmlFor={id} className="text-xs text-muted-foreground">
        {props.label}
      </label>
      {props.children(id)}
    </>
  );
}

function ReplyButtons(props: {
  readonly disabled: boolean;
  readonly canStore: boolean;
  readonly onStore: () => void;
  readonly onSkip: () => void;
}): React.JSX.Element {
  const text = useText();
  return (
    <div className="flex gap-2">
      <Button size="sm" disabled={props.disabled || !props.canStore} onClick={props.onStore}>
        {text("console.credential.store")}
      </Button>
      <Button size="sm" variant="outline" disabled={props.disabled} onClick={props.onSkip}>
        {text("console.credential.skip")}
      </Button>
    </div>
  );
}

function ReplyForm(props: {
  readonly view: CredentialRequestView;
  readonly disabled: boolean;
  readonly onReply: (reply: { readonly value?: string; readonly hosts: readonly string[] }) => void;
}): React.JSX.Element {
  const text = useText();
  const [value, setValue] = useState("");
  const [hosts, setHosts] = useState(props.view.allowedHosts.join("\n"));
  const store = (): void => {
    props.onReply({ value, hosts: hostsOf(hosts) });
    setValue("");
  };
  return (
    <>
      <Field label={text("console.credential.value")}>
        {(id) => (
          <input
            id={id}
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={value}
            disabled={props.disabled}
            onChange={(event) => setValue(event.target.value)}
            className={inputClass}
          />
        )}
      </Field>
      <Field label={text("console.credential.hosts")}>
        {(id) => (
          <textarea
            id={id}
            rows={2}
            value={hosts}
            disabled={props.disabled}
            onChange={(event) => setHosts(event.target.value)}
            className={inputClass}
          />
        )}
      </Field>
      <ReplyButtons
        disabled={props.disabled}
        canStore={value !== ""}
        onStore={store}
        onSkip={() => props.onReply({ hosts: [] })}
      />
    </>
  );
}

/**
 * The agent's request for a credential (decision 0388), above the composer: who asks, the name,
 * the agent's reason, whether a credential of the name is stored, a masked field for the value and
 * the hosts it may be sent to, which the owner edits. Store sends the value once and clears the
 * field; Skip declines. The value is never shown, kept in the page or written to the chat.
 */
export function CredentialRequestCard(props: {
  readonly agent: ProtocolId<"agent">;
  readonly agentName: string;
  readonly canAnswer: boolean;
}): React.JSX.Element | null {
  const text = useText();
  const { open, reply } = useCredentialRequest(props.agent);
  if (open === undefined) {
    return null;
  }
  return (
    <section
      aria-label={text("console.credential.label")}
      className="flex flex-col gap-2 rounded-lg border px-3 py-2 text-sm"
    >
      <RequestLines view={open} agentName={props.agentName} />
      <ReplyForm
        key={open.request}
        view={open}
        disabled={!props.canAnswer || reply.isPending}
        onReply={({ value, hosts }) =>
          reply.mutate({
            request: open,
            reply:
              value === undefined
                ? { kind: "skip" }
                : { kind: "store", value, allowedHosts: hosts },
          })
        }
      />
      {reply.error === null ? null : (
        <p role="alert" className="text-xs text-destructive">
          {errorWords(text, reply.error)}
        </p>
      )}
      <p className="text-xs text-muted-foreground">{text("console.credential.never")}</p>
    </section>
  );
}
