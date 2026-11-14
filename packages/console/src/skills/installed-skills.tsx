import { displayOutsideText } from "@binference/i18n";
import type { AgentView } from "@binference/protocol";
import { useId } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { MessageText, useFormatter, useText } from "../i18n/console-text";
import { ScreenState } from "../screens/screen-state";
import { type InstalledSkill, useInstalledSkills } from "./use-skill-review";

// A skill's description is outside text: cut and made visible.
const descriptionChars = 200;

// Where a skill came from, in the words of its place.
function OriginLine(props: { readonly installed: InstalledSkill }): React.JSX.Element {
  const text = useText();
  const formatter = useFormatter();
  const { skill, agentName } = props.installed;
  if (skill.place === "workspace") {
    const location = skill.location ?? skill.name;
    return (
      <MessageText
        text={text("console.skills.fromWorkspace", { name: agentName ?? "", location })}
      />
    );
  }
  if (skill.place === "installed") {
    const at = formatter.dateTime(skill.installedAt);
    const { source, hash } = skill;
    return <MessageText text={text("console.skills.fromInstalled", { source, at, hash })} />;
  }
  return <>{text("console.skills.fromBundled")}</>;
}

/**
 * The skills the agents can load (decision 0207), each with what its `SKILL.md` says it is and
 * where it came from: shipped with binference, installed from its pinned source, or one agent's
 * workspace. Installing one stays in the terminal.
 */
export function InstalledSkills(props: {
  readonly agents: readonly AgentView[];
}): React.JSX.Element {
  const text = useText();
  const id = useId();
  const installed = useInstalledSkills(props.agents);
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className="text-base font-semibold">
        {text("console.skills.installedList")}
      </h2>
      <p className="text-sm text-muted-foreground">
        <MessageText text={text("console.skills.installedIntro")} />
      </p>
      {installed.data === undefined ? <ScreenState error={installed.error} /> : null}
      {installed.data?.length === 0 ? (
        <p className="text-sm text-muted-foreground">{text("console.skills.installedNone")}</p>
      ) : null}
      <ul className="flex flex-col gap-3">
        {(installed.data ?? []).map((each) => (
          // Two agents' workspaces may each hold a skill of one name.
          <li key={`${each.skill.agent ?? ""}/${each.skill.skill}`}>
            <Card size="sm">
              <CardHeader>
                <CardTitle className="break-all">{each.skill.name}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-1 text-sm">
                {each.skill.description === undefined ? null : (
                  <p>{displayOutsideText(each.skill.description, descriptionChars)}</p>
                )}
                <p className="break-all text-muted-foreground">
                  <OriginLine installed={each} />
                </p>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}
