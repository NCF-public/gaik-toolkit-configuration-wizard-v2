/**
 * After the run, the sandbox Job prints every output file again, base64, so
 * the api can offer it as a download (sandbox-job.yaml, #314). The api reads
 * that block from the raw log; in the PoC tab's run log it is only noise —
 * thousands of base64 lines that push the run's own output out of the kept
 * tail. These markers bound it (case_service.FILES_BEGIN / FILES_END).
 */
const FILES_BEGIN = "=== POC FILES BEGIN ===";
const FILES_END = "=== POC FILES END ===";

/**
 * A filter for the lines of one run's log, in the order they arrive: false
 * for the files block, its markers included, true for everything else.
 * Stateful, since the block spans many lines; make one per run.
 */
export function runLogLineFilter(): (line: string) => boolean {
  let inFiles = false;
  return (line) => {
    if (line.startsWith(FILES_BEGIN)) {
      inFiles = true;
      return false;
    }
    if (inFiles) {
      if (line.startsWith(FILES_END)) inFiles = false;
      return false;
    }
    return true;
  };
}
