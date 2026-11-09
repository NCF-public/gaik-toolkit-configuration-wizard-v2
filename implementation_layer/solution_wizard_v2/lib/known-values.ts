// What the agent writes for something it has not learned yet ("unknown", "n/a",
// "tuntematon"). The review shows it as missing, not as an answer, and it does
// not count as captured when deciding whether Gate 1 can be approved.
const NOT_KNOWN = /^(unknown|n\/?a|none|tbd|-|tuntematon|ei tiedossa)$/i;

/** The value, or null when it is empty or a "not known yet" placeholder. */
export function known(value?: string | null): string | null {
  return value && !NOT_KNOWN.test(value.trim()) ? value : null;
}

/** The values that are not placeholders. */
export function knownList(values?: string[] | null): string[] {
  return (values ?? []).filter((v) => known(v) !== null);
}
