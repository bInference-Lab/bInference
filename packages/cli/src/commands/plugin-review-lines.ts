import { displayOutsideText, type Formatter } from "@binference/i18n";
import type { PluginReview } from "@binference/protocol";

// Every value a review shows is the plugin's or the registry's own text, shown as text set
// outside binference is (spec 4, section 3.10). No limit here cuts a declared name: the review
// schema bounds each list and name below these, so every entry shows whole.
const shortLength = 64;
const sourceLength = 1_000;
const nameLength = 200;

type Say = (key: string, values?: Readonly<Record<string, number | string>>) => string;

// A list as its heading and one line per entry; nothing when it lists nothing.
function listed(say: Say, key: string, names: readonly string[]): readonly string[] {
  if (names.length === 0) {
    return [];
  }
  const entries = names.map((name) =>
    say("review.entry", { name: displayOutsideText(name, nameLength) }),
  );
  return [say(key, { count: names.length }), ...entries];
}

const nameOf = (text: string | undefined): string => displayOutsideText(text ?? "?", nameLength);

// What an update asks beyond the installed version: another publisher, lost provenance, an older
// version, and every entry it adds.
function wideningLines(say: Say, review: PluginReview): readonly string[] {
  const widens = review.widens;
  if (widens === undefined) {
    return [];
  }
  const previous = displayOutsideText(widens.from, shortLength);
  const { publisher } = widens;
  const added = widens.added;
  return [
    ...(publisher === undefined
      ? []
      : [say("widen.publisher", { from: nameOf(publisher.from), to: nameOf(publisher.to) })]),
    ...(widens.lostProvenance === true ? [say("widen.lostProvenance", { previous })] : []),
    ...(widens.older === true ? [say("widen.older", { previous })] : []),
    ...listed(say, "widen.added", [
      ...added.kinds,
      ...added.hosts,
      ...added.tools,
      ...added.configKeys,
    ]),
  ];
}

/**
 * The permission review's lines in the owner's language (spec 4, section 3.10): its title, or a
 * widening's title and what it changes; the pin; the publisher and npm provenance, and the build
 * workflow when it lives in another repository; the hosts, tools, kinds and settings it declares,
 * one line each, every one of them; what a community plugin never does; and, without provenance,
 * that the owner must type the plugin's name.
 */
export function pluginReviewLines(formatter: Formatter, review: PluginReview): readonly string[] {
  const say: Say = (key, values = {}) => formatter.message(`plugin.${key}`, values);
  const plugin = displayOutsideText(review.plugin, shortLength);
  const version = displayOutsideText(review.version, shortLength);
  const widens = review.widens;
  const head =
    widens === undefined
      ? [
          say("review.title", {
            plugin,
            version,
            source: displayOutsideText(review.source, sourceLength),
          }),
        ]
      : [
          say("widen.title", {
            plugin,
            version,
            previous: displayOutsideText(widens.from, shortLength),
          }),
        ];
  const publisher = displayOutsideText(review.publisher ?? "?", nameLength);
  const workflow = review.workflow;
  return [
    ...head,
    ...wideningLines(say, review),
    say("review.hash", { hash: review.hash }),
    say("review.publisher", { publisher, provenance: review.provenance }),
    ...(workflow === undefined
      ? []
      : [say("review.workflow", { workflow: displayOutsideText(workflow, nameLength) })]),
    ...listed(say, "review.hosts", review.hosts),
    ...listed(say, "review.tools", review.tools),
    ...listed(say, "review.kinds", review.kinds),
    ...listed(say, "review.config", review.configKeys),
    say("review.never"),
    ...(review.provenance === "none" ? [say("review.typeName")] : []),
  ];
}
