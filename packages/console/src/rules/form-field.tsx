import { type ReactNode, useId } from "react";

/** The console's look of a text field and a picker, from the theme's tokens. */
export const fieldClass =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive";

/** A labelled field of the rule form: its label, the control, and a hint under it. */
export function FormField(props: {
  readonly label: string;
  readonly hint?: string;
  readonly children: (ids: { readonly id: string; readonly hintId?: string }) => ReactNode;
}): React.JSX.Element {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className="flex min-w-0 flex-col gap-1 text-sm">
      <label htmlFor={id} className="font-medium">
        {props.label}
      </label>
      {props.children(props.hint === undefined ? { id } : { id, hintId })}
      {props.hint === undefined ? null : (
        <p id={hintId} className="text-xs text-muted-foreground">
          {props.hint}
        </p>
      )}
    </div>
  );
}

/** A text field of the rule form, as the owner types it. */
export function TextField(props: {
  readonly label: string;
  readonly hint?: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly name: string;
  readonly placeholder?: string;
  readonly inputMode?: "decimal" | "numeric" | "text";
  readonly isRequired?: boolean;
}): React.JSX.Element {
  const { label, hint, value, name, placeholder, inputMode = "text", isRequired = false } = props;
  return (
    <FormField label={label} {...(hint === undefined ? {} : { hint })}>
      {({ id, hintId }) => (
        <input
          id={id}
          name={name}
          value={value}
          inputMode={inputMode}
          required={isRequired}
          autoComplete="off"
          spellCheck={false}
          {...(placeholder === undefined ? {} : { placeholder })}
          {...(hintId === undefined ? {} : { "aria-describedby": hintId })}
          onChange={(event) => props.onChange(event.target.value)}
          className={fieldClass}
        />
      )}
    </FormField>
  );
}
