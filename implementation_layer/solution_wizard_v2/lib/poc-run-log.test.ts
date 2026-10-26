import { describe, expect, it } from "vitest";
import { runLogLineFilter } from "@/lib/poc-run-log";

// The run log showed the base64 copy of every output file the sandbox Job
// prints for downloads (#314). The block must not reach the displayed log;
// what the run printed before and after it must.

function shown(lines: string[]): string[] {
  const keep = runLogLineFilter();
  return lines.filter(keep);
}

describe("runLogLineFilter", () => {
  it("hides the files block and its markers", () => {
    expect(
      shown([
        "Processing invoice.pdf",
        "=== POC OUTPUT BEGIN === r1",
        '{"total": 12}',
        "=== POC OUTPUT END === r1",
        "=== POC FILES BEGIN === r1",
        "--- file result.json 13 --- r1",
        "eyJ0b3RhbCI6IDEyfQo=",
        "--- skipped big.pdf 9999999 --- r1",
        "=== POC FILES END === r1",
      ]),
    ).toEqual([
      "Processing invoice.pdf",
      "=== POC OUTPUT BEGIN === r1",
      '{"total": 12}',
      "=== POC OUTPUT END === r1",
    ]);
  });

  it("shows lines after the block ends", () => {
    expect(
      shown(["=== POC FILES BEGIN === ", "QUJD", "=== POC FILES END === ", "after"]),
    ).toEqual(["after"]);
  });

  it("keeps hiding a block that has not ended yet", () => {
    expect(shown(["before", "=== POC FILES BEGIN === r2", "QUJD", "REVG"])).toEqual([
      "before",
    ]);
  });

  it("leaves a log without the block as it is", () => {
    expect(shown(["a", "b"])).toEqual(["a", "b"]);
  });
});
