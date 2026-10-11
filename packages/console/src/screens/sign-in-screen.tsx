import { LoaderCircleIcon, RotateCwIcon } from "lucide-react";
import { BrandLockup } from "../brand/brand-lockup";
import { Button } from "../components/ui/button";
import { MessageText, useText } from "../i18n/console-text";
import type { SessionState, SignedOutReason } from "../session/session-state";

const reasonKeys: Readonly<Record<SignedOutReason, string>> = {
  no_device: "console.signIn.noDevice",
  used: "console.signIn.used",
  expired: "console.signIn.expired",
  refused: "console.signIn.refused",
  revoked: "console.signIn.revoked",
  no_crypto: "console.signIn.noCrypto",
  mini_failed: "console.signIn.miniFailed",
  unreachable: "console.signIn.unreachable",
};

const stepKeys = {
  starting: "console.signIn.starting",
  pairing: "console.signIn.pairing",
  connecting: "console.signIn.connecting",
} as const;

/** The page before the console: each step of signing in, or why it stopped and what to do. */
export function SignInScreen(props: {
  readonly state: Exclude<SessionState, { readonly kind: "ready" }>;
  readonly retry: () => void;
}): React.JSX.Element {
  const text = useText();
  const { state } = props;
  return (
    <main className="flex min-h-svh items-center justify-center px-4 py-10">
      <section className="flex w-full max-w-md flex-col items-center gap-6 text-center">
        <img src="/hermes.svg" alt="" aria-hidden="true" className="h-40 w-auto" />
        <BrandLockup className="h-8 w-auto text-foreground" />
        <h1 className="text-lg font-semibold">{text("console.signIn.title")}</h1>
        {state.kind === "signed_out" ? (
          <p className="text-sm text-muted-foreground" role="alert">
            <MessageText text={text(reasonKeys[state.reason])} />
          </p>
        ) : (
          <output className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircleIcon className="size-4 animate-spin" strokeWidth={1.5} aria-hidden />
            {text(stepKeys[state.kind])}
          </output>
        )}
        {state.kind === "signed_out" && state.reason === "unreachable" ? (
          <Button variant="outline" onClick={props.retry}>
            <RotateCwIcon data-icon="inline-start" strokeWidth={1.5} aria-hidden />
            {text("console.signIn.retry")}
          </Button>
        ) : null}
      </section>
    </main>
  );
}
