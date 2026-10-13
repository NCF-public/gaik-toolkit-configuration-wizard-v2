import { describe, expect, it } from "vitest";
import {
  DEV_USERS,
  devUsers,
  isDevUserEmail,
  parseDevUsers,
  validateDevCredentials,
} from "./auth";

const env = (vars: Record<string, string>) => vars as unknown as NodeJS.ProcessEnv;

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

  it("does not treat object built-ins as accounts", () => {
    expect(isDevUserEmail("constructor")).toBe(false);
    expect(validateDevCredentials("toString", "x")).toBe(false);
  });
});

describe("dev accounts come from the deployment", () => {
  it("uses WIZARD_DEV_USERS when it is set", () => {
    expect(
      devUsers(env({ NODE_ENV: "production", WIZARD_DEV_USERS: "a@x.fi:one, b@x.fi:two" })),
    ).toEqual({ "a@x.fi": "one", "b@x.fi": "two" });
  });

  it("has no account in a production build without WIZARD_DEV_USERS", () => {
    // The built-in accounts are in a public repository; a deployed instance
    // must never fall back to them.
    expect(devUsers(env({ NODE_ENV: "production" }))).toEqual({});
  });

  it("keeps the built-in accounts for a local checkout", () => {
    expect(Object.keys(devUsers(env({ NODE_ENV: "development" })))).toEqual([
      "dev@gaik.local",
      "dev2@gaik.local",
    ]);
  });

  it("skips malformed entries and keeps colons in passwords", () => {
    expect(parseDevUsers("broken, :nouser, c@x.fi:pa:ss ,d@x.fi:")).toEqual({
      "c@x.fi": "pa:ss",
    });
  });
});
