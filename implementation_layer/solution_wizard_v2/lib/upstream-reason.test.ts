import { describe, expect, it } from "vitest";
import { REASON_MAX_CHARS, reasonFromDetail, upstreamReason } from "./upstream-reason";

describe("reasonFromDetail", () => {
  it("reads a plain detail string", () => {
    expect(reasonFromDetail({ detail: "scaffolding failed: x" })).toBe("scaffolding failed: x");
  });

  it("prefers message over error in a structured detail (the gate answer)", () => {
    expect(
      reasonFromDetail({
        detail: {
          error: "gate_not_approved",
          message: "approve Gate 2 before generating the PoC package",
        },
      }),
    ).toBe("approve Gate 2 before generating the PoC package");
  });

  it("falls back to the error code when there is no message", () => {
    expect(reasonFromDetail({ detail: { error: "gate_not_approved" } })).toBe("gate_not_approved");
  });

  it("flattens whitespace to one line and shortens a long reason", () => {
    expect(reasonFromDetail({ detail: "a\n  b\t c" })).toBe("a b c");
    const long = reasonFromDetail({ detail: "x".repeat(1000) }) as string;
    expect(long.length).toBe(REASON_MAX_CHARS);
    expect(long.endsWith("…")).toBe(true);
  });

  it("is null for anything that is not text", () => {
    expect(reasonFromDetail(null)).toBeNull();
    expect(reasonFromDetail("x")).toBeNull();
    expect(reasonFromDetail({})).toBeNull();
    expect(reasonFromDetail({ detail: 503 })).toBeNull();
    expect(reasonFromDetail({ detail: "   " })).toBeNull();
    expect(reasonFromDetail({ detail: { message: ["a"] } })).toBeNull();
  });
});

describe("upstreamReason", () => {
  it("reads the body of a failed response", async () => {
    const res = new Response(JSON.stringify({ detail: "blueprint is not scaffoldable: x" }), {
      status: 503,
    });
    expect(await upstreamReason(res)).toBe("blueprint is not scaffoldable: x");
  });

  it("is null when the body is not JSON", async () => {
    expect(await upstreamReason(new Response("<html>bad gateway</html>", { status: 502 }))).toBeNull();
  });
});
