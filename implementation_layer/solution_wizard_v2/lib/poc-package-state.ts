/**
 * What the PoC tab knows about the generated package.
 *
 * wizard_api's `GET /sessions/{id}/poc/files` answers `generated` (files
 * exist) and, since the package check, `ready` plus `problems` (the files add
 * up to a package worth handing over). The tab used to read only `generated`,
 * so a package the API itself called not ready — an unwired run_poc.py, no gaik
 * in the requirements — was shown as "Generated PoC package" with a download
 * button and an enabled sandbox run.
 *
 * An answer without `ready` (the mock store, an older api) does not say the
 * package is bad, so it counts as ready: only an explicit `ready: false`
 * withholds the download and the run.
 */
export type PocPackageState = {
  generated: boolean;
  ready: boolean;
  problems: string[];
  files: string[];
  /** The sandbox run wizard_api has recorded as successful, or null (#143, #253). */
  recordedRun: string | null;
  /** Digest of the files a preflight reads; a new one means the agent changed the package. */
  version: string | null;
};

export const NO_POC_PACKAGE: PocPackageState = {
  generated: false,
  ready: false,
  problems: [],
  files: [],
  recordedRun: null,
  version: null,
};

export function pocPackageState(raw: unknown): PocPackageState {
  if (typeof raw !== "object" || raw === null) return NO_POC_PACKAGE;
  const d = raw as {
    generated?: unknown;
    ready?: unknown;
    problems?: unknown;
    files?: unknown;
    recordedRun?: unknown;
    version?: unknown;
  };
  const recordedRun = typeof d.recordedRun === "string" && d.recordedRun ? d.recordedRun : null;
  const version = typeof d.version === "string" && d.version ? d.version : null;
  const generated = Boolean(d.generated);
  if (!generated) return { ...NO_POC_PACKAGE, recordedRun };
  const strings = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  return {
    generated: true,
    ready: d.ready !== false,
    problems: strings(d.problems),
    files: strings(d.files),
    recordedRun,
    version,
  };
}

/** The two answers describe the same package, so there is nothing to re-render. */
export function samePocPackage(a: PocPackageState, b: PocPackageState): boolean {
  return (
    a.generated === b.generated &&
    a.ready === b.ready &&
    a.recordedRun === b.recordedRun &&
    a.version === b.version &&
    a.problems.length === b.problems.length &&
    a.problems.every((p, i) => p === b.problems[i]) &&
    a.files.length === b.files.length &&
    a.files.every((f, i) => f === b.files[i])
  );
}
