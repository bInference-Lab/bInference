import type { WordKey, Words } from "../words/words";

/** One line a pinned scene shows, between two points of its progress. */
export interface SceneLine {
  readonly key: WordKey;
  readonly from: number;
  readonly to: number;
}

/**
 * The lines a pinned scene shows one after another, each between its points of `--p`; the
 * scene's own styles place them and fade them.
 */
export function SceneLines(props: {
  readonly words: Words;
  readonly lines: readonly SceneLine[];
  readonly className: string | undefined;
  readonly lineClassName: string | undefined;
}): React.JSX.Element {
  const { words } = props;
  return (
    <div className={props.className}>
      {props.lines.map((line) => (
        <p
          key={line.key}
          className={props.lineClassName}
          style={{ "--a": line.from, "--b": line.to }}
        >
          {words.rich(line.key)}
        </p>
      ))}
    </div>
  );
}
