import { describe, expect, it } from "vitest";
import {
  DEV_USERS,
  formatDevAccountsHint,
  isDevUserEmail,
  validateDevCredentials,
} from "./auth";

describe("dev auth", () => {
  it("accepts both dev accounts", () => {
    for (const [email, password] of Object.entries(DEV_USERS)) {
      expect(validateDevCredentials(email, password)).toBe(true);
      expect(isDevUserEmail(email)).toBe(true);
    }
  });

  it("rejects wrong password and unknown email", () => {
    expect(validateDevCredentials("dev@gaik.local", "wrong")).toBe(false);
    expect(validateDevCredentials("other@gaik.local", "gaik")).toBe(false);
    expect(isDevUserEmail("other@gaik.local")).toBe(false);
  });

  it("formats account hint for login errors", () => {
    expect(formatDevAccountsHint()).toContain("dev@gaik.local / gaik");
    expect(formatDevAccountsHint()).toContain("dev2@gaik.local / gaik2");
  });
});
