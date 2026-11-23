import { AgentProvider } from "../agent/agent-context";
import { AgentStage } from "../agent/agent-stage";
import { SiteHeader } from "../header/site-header";
import { Assembly } from "../sections/assembly";
import { Boundary } from "../sections/boundary";
import { CardScene } from "../sections/card-scene";
import { Day } from "../sections/day";
import { Gate } from "../sections/gate";
import { Hero } from "../sections/hero";
import { Install } from "../sections/install";
import { Playground } from "../sections/playground";
import { SiteFooter } from "../sections/site-footer";
import { SourceWall } from "../sections/source-wall";
import { Takeover } from "../sections/takeover";
import { Tools } from "../sections/tools";
import { type Locale, wordsFor, type Words } from "../words/words";
import {
  boundaryWords,
  dayEntries,
  demoRuns,
  playgroundWords,
  takeoverIdeas,
  toolList,
} from "./section-words";

const otherLanguage: Readonly<
  Record<Locale, { readonly locale: Locale; readonly href: string; readonly lang: string }>
> = {
  en: { locale: "zh", href: "/zh", lang: "zh-Hans" },
  zh: { locale: "en", href: "/", lang: "en" },
};

function Header(props: { readonly words: Words }): React.JSX.Element {
  const { words } = props;
  const other = otherLanguage[words.locale];
  return (
    <SiteHeader
      chapters={[
        { href: "#day", label: words.text("nav.day") },
        { href: "#play", label: words.text("nav.talk") },
        { href: "#readme", label: words.text("nav.source") },
      ]}
      chaptersLabel={words.text("nav.label")}
      start={words.text("nav.start")}
      other={{
        href: other.href,
        lang: other.lang,
        label: wordsFor(other.locale).text("language.self"),
      }}
      tally={{ taps: words.text("tally.taps"), moved: words.text("tally.moved") }}
    />
  );
}

/** The landing page in one language: the agent, awake on the reader's tap, through every scene. */
export function Landing(props: { readonly locale: Locale }): React.JSX.Element {
  const words = wordsFor(props.locale);
  return (
    <AgentProvider>
      <Gate
        words={{
          line: words.rich("gate.line"),
          nudge: words.text("gate.nudge"),
        }}
      />
      <AgentStage
        words={{
          agent: words.text("status.agent"),
          asleep: words.text("status.asleep"),
          watching: words.text("status.watching"),
          poke: words.text("status.poke"),
        }}
      />
      <Header words={words} />
      <main>
        <Hero words={words} />
        <Takeover ideas={takeoverIdeas(words)} />
        <Day
          words={{
            title: words.rich("day.title"),
            example: words.text("day.example"),
            label: words.text("status.day"),
          }}
          entries={dayEntries(words)}
        />
        <Tools
          words={{ title: words.split("tools.title"), label: words.text("status.tools") }}
          tools={toolList(words)}
        />
        <CardScene words={words} />
        <Playground words={playgroundWords(words)} runs={demoRuns(words)} />
        <SourceWall words={words} />
        <Boundary words={boundaryWords(words)} />
        <Assembly words={words} />
        <Install words={words} />
      </main>
      <SiteFooter words={words} />
    </AgentProvider>
  );
}
