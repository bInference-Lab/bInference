"use client";

import { useState } from "react";
import { useAgent } from "../agent/agent-context";

/** A button that copies `text`, counts as a tap, and says so for a moment. */
export function CopyButton(props: {
  readonly text: string;
  readonly label: string;
  readonly done: string;
}): React.JSX.Element {
  const bus = useAgent();
  const [copied, setCopied] = useState(false);
  const copy = async (): Promise<void> => {
    bus.tap();
    bus.pulse();
    try {
      await navigator.clipboard.writeText(props.text);
    } catch {
      // Without clipboard access the reader copies the command from the page.
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  return (
    <button
      type="button"
      className="btn btn-sm"
      data-agent-target="install-copy"
      onClick={() => void copy()}
    >
      {copied ? props.done : props.label}
    </button>
  );
}
