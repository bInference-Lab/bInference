import type { ProtocolId } from "@binference/protocol";
import { CheckIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "../components/ui/card";
import { FailedAlert } from "../connection/failed-alert";
import { useText } from "../i18n/console-text";
import { useAcceptSkill, useWaitingSkills, type WaitingSkill } from "./use-skill-review";

// One waiting skill, its folder named so the owner checks it, and Accept, asked once more.
function WaitingItem(props: {
  readonly agent: ProtocolId<"agent">;
  readonly skill: WaitingSkill;
}): React.JSX.Element {
  const text = useText();
  const [isAsking, ask] = useState(false);
  const accept = useAcceptSkill();
  const { agent, skill } = props;
  const location = skill.location ?? skill.name;
  const run = (): void => {
    ask(false);
    accept.mutate({ agent, skill: skill.name, hash: skill.hash });
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>{skill.name}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        <p>{text("console.skills.waiting", { location })}</p>
        <FailedAlert error={accept.error} wordsKey="console.skills.failed" />
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        {isAsking ? (
          <>
            <p className="w-full text-sm">
              {text("console.skills.acceptAsk", { name: skill.name })}
            </p>
            <Button type="button" onClick={run}>
              {text("console.skills.acceptConfirm")}
            </Button>
            <Button type="button" variant="outline" onClick={() => ask(false)}>
              {text("console.skills.keep")}
            </Button>
          </>
        ) : (
          <Button type="button" disabled={accept.isPending} onClick={() => ask(true)}>
            <CheckIcon data-icon="inline-start" strokeWidth={1.5} aria-hidden />
            {text("console.skills.accept")}
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}

/**
 * One agent's workspace skills that wait for the owner to accept their files (decision 0408), each
 * with Accept bound to the folder hash the list read; none shows nothing.
 */
export function WaitingSkills(props: {
  readonly agent: ProtocolId<"agent">;
}): React.JSX.Element | null {
  const text = useText();
  const waiting = useWaitingSkills(props.agent).data ?? [];
  if (waiting.length === 0) {
    return null;
  }
  return (
    <ul aria-label={text("console.skills.waitingList")} className="flex flex-col gap-4">
      {waiting.map((skill) => (
        <li key={skill.name}>
          <WaitingItem agent={props.agent} skill={skill} />
        </li>
      ))}
    </ul>
  );
}
