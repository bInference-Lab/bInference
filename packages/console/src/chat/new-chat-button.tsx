import { RotateCcwIcon } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "../components/ui/button";
import { useText } from "../i18n/console-text";

/**
 * New chat, asked once more before it clears: the first press shows what a new chat forgets and
 * keeps, with Start new chat and Keep this chat; only Start new chat calls `start`.
 */
export function NewChatButton(props: {
  readonly canStart: boolean;
  readonly start: () => void;
}): React.JSX.Element {
  const text = useText();
  const id = useId();
  const [isAsking, setAsking] = useState(false);
  if (!isAsking) {
    return (
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          disabled={!props.canStart}
          onClick={() => setAsking(true)}
        >
          <RotateCcwIcon data-icon="inline-start" strokeWidth={1.5} aria-hidden />
          {text("console.chat.clear")}
        </Button>
      </div>
    );
  }
  return (
    <section
      aria-labelledby={id}
      className="flex flex-wrap items-center justify-end gap-2 rounded-lg border px-3 py-2 text-sm"
    >
      <p id={id} className="mr-auto">
        {text("console.chat.clearAsk")}
      </p>
      <Button variant="outline" size="sm" onClick={() => setAsking(false)}>
        {text("console.chat.clearKeep")}
      </Button>
      <Button
        size="sm"
        disabled={!props.canStart}
        onClick={() => {
          setAsking(false);
          props.start();
        }}
      >
        {text("console.chat.clearStart")}
      </Button>
    </section>
  );
}
