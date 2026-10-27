/**
 * Where the session page goes after "Next step", "Previous" or a gate approval.
 *
 * A refusal comes back as ?notice= (agent busy, gate not ready). The notice
 * used to stay in the URL after the next click went through, so the page kept
 * saying the wizard was still working on a step it had already left. A form
 * shown with a notice says so (`hadNotice`), and a successful action then
 * goes back to the plain session URL. null: stay where the page is.
 */
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
