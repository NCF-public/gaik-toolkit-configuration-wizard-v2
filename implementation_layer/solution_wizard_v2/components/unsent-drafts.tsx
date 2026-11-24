"use client";

import { createContext, useContext, useEffect, type ReactNode } from "react";
import { clearUnsentBlueprints, sweepUnsentBlueprints } from "@/lib/unsent-blueprint";

/**
 * The signed-in user's pseudonym for the Blueprint form's drafts kept in this
 * browser (lib/unsent-blueprint): only that user's are kept and taken back.
 * Null outside the signed-in pages: nothing is kept there.
 */
const Owner = createContext<string | null>(null);

/** Gives the pages the owner, and erases the drafts not theirs or too old as the app opens. */
export function UnsentDraftsOwner({ owner, children }: { owner: string; children: ReactNode }) {
  useEffect(() => {
    sweepUnsentBlueprints(owner);
  }, [owner]);
  return <Owner.Provider value={owner}>{children}</Owner.Provider>;
}

export function useUnsentDraftsOwner(): string | null {
  return useContext(Owner);
}

/** The sign-out form's button: the drafts kept in this browser go before the sign-out is sent. */
export function SignOutSubmit({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <button type="submit" className={className} onClick={() => clearUnsentBlueprints()}>
      {children}
    </button>
  );
}
