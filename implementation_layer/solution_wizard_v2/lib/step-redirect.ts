/**
 * Where the session page goes after a gate decision (the only step action the
 * page has: the steps between gates have no buttons).
 *
 * A refusal comes back as ?notice= (agent busy, gate not ready). The notice
 * used to stay in the URL after the next click went through, so the page kept
 * saying the wizard was still working on a step it had already left. A form
 * shown with a notice says so (`hadNotice`), and a successful action then
 * goes back to the plain session URL. null: stay where the page is.
 */
/** ?notice= for a gate decision made on a page the session had already left. */
export const GATE_MOVED_NOTICE = "gate_moved";

/**
 * The address without the one-time parameters an action left in it (`wake`,
 * `notice`), keeping the rest (the open tab), with `notice` set when given.
 */
export function withoutStepParams(pathname: string, search: string, notice?: string): string {
  const params = new URLSearchParams(search);
  params.delete("wake");
  params.delete("notice");
  if (notice) params.set("notice", notice);
  const rest = params.toString();
  return rest ? `${pathname}?${rest}` : pathname;
}

export function afterStepAction(
  id: string,
  { notice, wake, hadNotice }: { notice?: string | null; wake?: number; hadNotice?: boolean },
): string | null {
  if (notice) return `/sessions/${id}?notice=${notice}`;
  // The approved gate's chat turn (#173), which also drops an old notice.
  if (wake !== undefined) return `/sessions/${id}?wake=${wake}`;
  if (hadNotice) return `/sessions/${id}`;
  return null;
}
