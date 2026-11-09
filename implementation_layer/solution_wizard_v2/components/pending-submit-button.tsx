"use client";

import { useFormStatus } from "react-dom";

// A submit button that says what it is doing. The step and gate actions take
// 20–60 s when the agent is busy on the same session (#170); a plain button
// gave no sign that the click registered, so people clicked again.
export function PendingSubmitButton({
  label,
  pendingLabel,
  className,
  disabled = false,
  title,
}: {
  label: string;
  pendingLabel: string;
  className: string;
  disabled?: boolean;
  /** Says why the button is disabled, where that is not obvious. */
  title?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      title={title}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      aria-live="polite"
      className={className}
    >
      {pending ? pendingLabel : label}
    </button>
  );
}
