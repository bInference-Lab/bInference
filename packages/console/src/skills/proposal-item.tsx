import { displayOutsideText } from "@binference/i18n";
import type { SkillProposalDetail, SkillProposalView } from "@binference/protocol";
import { CheckIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { Alert, AlertDescription } from "../components/ui/alert";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "../components/ui/card";
import { FailedAlert } from "../connection/failed-alert";
import { useText } from "../i18n/console-text";
import { ScreenState } from "../screens/screen-state";
import { useDecideProposal, useProposal } from "./use-skill-review";

// The agent's words show cut and made visible.
const lineChars = 200;
const marks = { add: "+", remove: "-", same: " " } as const;
const tones = {
  add: "text-foreground",
  remove: "text-muted-foreground line-through",
  same: "text-muted-foreground",
} as const;

// The proposal's changes to its `SKILL.md`, a line each, added and removed ones marked.
function ProposalDiff(props: { readonly detail: SkillProposalDetail }): React.JSX.Element {
  const text = useText();
  const { detail } = props;
  return (
    <figure className="flex flex-col gap-1">
      <figcaption className="text-muted-foreground">{text("console.skills.diff")}</figcaption>
      <pre className="overflow-x-auto rounded-md bg-muted p-2 font-mono text-xs">
        {detail.diff.map((line, index) => (
          // oxlint-disable-next-line eslint-plugin-react/no-array-index-key -- a diff's lines repeat; their place is their key
          <div key={index} className={tones[line.kind]}>
            {`${marks[line.kind]} ${displayOutsideText(line.text, lineChars)}`}
          </div>
        ))}
      </pre>
      {detail.diffCut ? (
        <p className="text-muted-foreground">{text("console.skills.diffCut")}</p>
      ) : null}
    </figure>
  );
}

function Findings(props: { readonly detail: SkillProposalDetail }): React.JSX.Element | null {
  const text = useText();
  const { findings } = props.detail;
  if (findings.length === 0) {
    return null;
  }
  return (
    <Alert variant="destructive">
      <AlertDescription className="flex flex-col gap-1">
        <p>{text("console.skills.blocked")}</p>
        <ul>
          {findings.map(({ file, line, code, text: sentence }) => (
            <li key={`${file}:${String(line)}:${code}`}>
              {text("console.skills.finding", {
                file,
                line,
                code,
                text: displayOutsideText(sentence, lineChars),
              })}
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}

// Apply, asked once more before it applies, and Reject; Apply is left out while a finding blocks.
function Decisions(props: {
  readonly detail: SkillProposalDetail;
  readonly decide: ReturnType<typeof useDecideProposal>;
}): React.JSX.Element {
  const text = useText();
  const [isAsking, ask] = useState(false);
  const { detail, decide } = props;
  const run = (act: "apply" | "reject"): void => {
    ask(false);
    decide.mutate({ proposal: detail.proposal, act });
  };
  if (isAsking) {
    return (
      <div className="flex w-full flex-col gap-2">
        <p className="text-sm">{text("console.skills.applyAsk", { name: detail.name })}</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => run("apply")}>
            {text("console.skills.applyConfirm")}
          </Button>
          <Button type="button" variant="outline" onClick={() => ask(false)}>
            {text("console.skills.keep")}
          </Button>
        </div>
      </div>
    );
  }
  return (
    <>
      {detail.findings.length === 0 ? (
        <Button type="button" disabled={decide.isPending} onClick={() => ask(true)}>
          <CheckIcon data-icon="inline-start" strokeWidth={1.5} aria-hidden />
          {text("console.skills.apply")}
        </Button>
      ) : null}
      <Button
        type="button"
        variant="outline"
        disabled={decide.isPending}
        onClick={() => run("reject")}
      >
        <XIcon data-icon="inline-start" strokeWidth={1.5} aria-hidden />
        {text("console.skills.reject")}
      </Button>
    </>
  );
}

/**
 * One pending skill proposal (decision 0408): its name, kind and description, the scan findings
 * that block it, the lines it changes, and Apply, asked once more, and Reject.
 */
export function ProposalItem(props: { readonly view: SkillProposalView }): React.JSX.Element {
  const text = useText();
  const { view } = props;
  const detail = useProposal(view.proposal);
  const decide = useDecideProposal();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <span>{view.name}</span>
          <Badge variant="outline">{text("console.skills.kind", { kind: view.kind })}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        <p>{displayOutsideText(view.description, lineChars)}</p>
        {view.purpose === undefined ? null : (
          <p className="text-muted-foreground">
            {text("console.skills.purpose", {
              purpose: displayOutsideText(view.purpose, lineChars),
            })}
          </p>
        )}
        {detail.data === undefined ? (
          <ScreenState error={detail.error} />
        ) : (
          <Findings detail={detail.data} />
        )}
        {detail.data === undefined ? null : <ProposalDiff detail={detail.data} />}
        <FailedAlert error={decide.error} wordsKey="console.skills.failed" />
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        {detail.data === undefined ? null : <Decisions detail={detail.data} decide={decide} />}
      </CardFooter>
    </Card>
  );
}
