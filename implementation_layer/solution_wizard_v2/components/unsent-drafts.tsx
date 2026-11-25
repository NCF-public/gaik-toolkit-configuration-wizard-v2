"use client";

import { createContext, useContext, useEffect, type ReactNode } from "react";
import {
  resumeKeepingUnsentBlueprints,
  stopKeepingUnsentBlueprints,
  sweepUnsentBlueprints,
} from "@/lib/unsent-blueprint";

/**
 * The signed-in user's pseudonym for the Blueprint form's drafts kept in this
 * browser (lib/unsent-blueprint): only that user's are kept and taken back.
 * Null outside the signed-in pages: nothing is kept there.
 */
const Owner = createContext<string | null>(null);

/**
 * Gives the pages the owner. As the app opens for a signed-in user, their
 * drafts are kept again after a sign-out, and the drafts not theirs or too old
 * are erased.
 */
export function UnsentDraftsOwner({ owner, children }: { owner: string; children: ReactNode }) {
  useEffect(() => {
    resumeKeepingUnsentBlueprints(owner);
    sweepUnsentBlueprints(owner);
  }, [owner]);
  return <Owner.Provider value={owner}>{children}</Owner.Provider>;
}

export function useUnsentDraftsOwner(): string | null {
  return useContext(Owner);
}

/**
 * The sign-out form's button. Before the sign-out is sent, the drafts kept in
 * this browser go, and no form in any tab keeps `owner`'s again until they
 * sign in: the page that goes as the sign-out lands would otherwise keep its
 * form's draft once more.
 */
export function SignOutSubmit({
  owner,
  className,
  children,
}: {
  owner: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button type="submit" className={className} onClick={() => stopKeepingUnsentBlueprints(owner)}>
      {children}
    </button>
  );
}
