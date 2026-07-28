import { describe, expect, it } from "vitest";
import {
  TargetPolicyError,
  isPrivateAddress,
  validateResponseSize,
  validateTarget,
} from "../src/index";

const dns = async (address: string) => [{ address, family: 4 as const }];

describe("security: target policy", () => {
  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "::1",
    "fc00::1",
    "fe80::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "2002:7f00:1::",
    "198.51.100.1",
    "203.0.113.1",
  ])("classifies %s as private or special-use", (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it("allows a public HTTPS target with public DNS", async () => {
    const result = await validateTarget(
      "https://example.test/path",
      "public",
      () => dns("93.184.216.34"),
    );
    expect(result.addresses).toEqual(["93.184.216.34"]);
  });

  it.each([
    ["http://example.test", "public"],
    ["https://user:secret@example.test", "public"],
    ["file:///etc/passwd", "local-explicit"],
    ["data:text/html,test", "local-explicit"],
  ] as const)("rejects %s in %s mode", async (url, policy) => {
    await expect(
      validateTarget(url, policy, () => dns("93.184.216.34")),
    ).rejects.toBeInstanceOf(TargetPolicyError);
  });

  it("rejects public DNS rebinding to a private address", async () => {
    await expect(
      validateTarget("https://example.test", "public", () =>
        dns("169.254.169.254"),
      ),
    ).rejects.toMatchObject({ code: "TARGET_POLICY_DENIED" });
  });

  it("allows loopback only when local-explicit is selected", async () => {
    await expect(
      validateTarget("http://127.0.0.1:4173", "local-explicit", () =>
        dns("127.0.0.1"),
      ),
    ).resolves.toMatchObject({ addresses: ["127.0.0.1"] });
    await expect(
      validateTarget("https://127.0.0.1", "public", () => dns("127.0.0.1")),
    ).rejects.toMatchObject({ code: "TARGET_POLICY_DENIED" });
  });

  it("normalizes bracketed IPv6 literals before policy checks", async () => {
    await expect(
      validateTarget("http://[::1]:4173", "local-explicit", async () => {
        throw new Error("DNS must not be used for IP literals.");
      }),
    ).resolves.toMatchObject({ addresses: ["::1"] });
    await expect(
      validateTarget("https://[::1]", "public", async () => []),
    ).rejects.toMatchObject({ code: "TARGET_POLICY_DENIED" });
  });

  it("allows globally routable IPv6 addresses", () => {
    expect(isPrivateAddress("2606:4700:4700::1111")).toBe(false);
  });

  it("enforces declared response-size bounds", () => {
    expect(() =>
      validateResponseSize({ "content-length": "1024" }, 1024),
    ).not.toThrow();
    expect(() =>
      validateResponseSize({ "Content-Length": "1025" }, 1024),
    ).toThrow(TargetPolicyError);
    expect(() =>
      validateResponseSize({ "content-length": "not-a-number" }, 1024),
    ).toThrow(TargetPolicyError);
    expect(() => validateResponseSize({}, 1024)).not.toThrow();
  });
});
