"use client";

import { useSyncExternalStore, type ComponentProps } from "react";
import { ChatDock } from "@/components/chat-dock";
import { resultStaleFor, subscribeResultStale } from "@/lib/poc-result-state";
import { GATE_STEPS } from "@/lib/wizard-state-machine";

/**
 * The session page's chat. The approval the wizard's reply carries is the same
 * decision as the bar's under the workspace, so it waits with it: Gate 3 is
 * not offered under a reply while the test result on the PoC tab is, or may
 * be, an earlier package's (lib/poc-result-state). The bar says why.
 */
export function SessionChatDock(props: ComponentProps<typeof ChatDock>) {
  const resultStale = useSyncExternalStore(
    subscribeResultStale,
    () => resultStaleFor(props.sessionId),
    () => false,
  );
  const waits = resultStale && props.gateAction?.gateStep === GATE_STEPS[2];
  return <ChatDock {...props} gateAction={waits ? undefined : props.gateAction} />;
}
