import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import type { DnsResolver, TargetValidation } from "./types";

export class TargetPolicyError extends Error {
  readonly code: "INVALID_TARGET" | "TARGET_POLICY_DENIED";

  constructor(
    code: "INVALID_TARGET" | "TARGET_POLICY_DENIED",
    message: string,
  ) {
    super(message);
    this.name = "TargetPolicyError";
    this.code = code;
  }
}

const defaultResolver: DnsResolver = async (hostname) => {
  const results = await lookup(hostname, { all: true, verbatim: true });
  return results.map(({ address, family }) => ({
    address,
    family: family as 4 | 6,
  }));
};

function parseIpv4(address: string): number[] | undefined {
  if (isIP(address) !== 4) {
    return undefined;
  }
  return address.split(".").map(Number);
}

function ipv4Private(address: string): boolean {
  const octets = parseIpv4(address);
  if (!octets) {
    return false;
  }
  const [a, b] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 88) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51) ||
    (a === 203 && b === 0) ||
    a >= 224
  );
}

function normalizeIpv6(address: string): string {
  return address.toLowerCase().split("%")[0] ?? address.toLowerCase();
}

function parseIpv6Bytes(address: string): Uint8Array | undefined {
  let value = normalizeIpv6(address);
  if (isIP(value) !== 6) {
    return undefined;
  }

  const ipv4Tail = value.match(/(\d{1,3}(?:\.\d{1,3}){3})$/)?.[1];
  if (ipv4Tail !== undefined) {
    const octets = parseIpv4(ipv4Tail);
    if (octets === undefined || octets.some((octet) => octet > 255)) {
      return undefined;
    }
    const replacement = `${(((octets[0] ?? 0) << 8) | (octets[1] ?? 0)).toString(16)}:${(((octets[2] ?? 0) << 8) | (octets[3] ?? 0)).toString(16)}`;
    value = `${value.slice(0, -ipv4Tail.length)}${replacement}`;
  }

  const halves = value.split("::");
  if (halves.length > 2) {
    return undefined;
  }
  const head = halves[0] === "" ? [] : halves[0]?.split(":") ?? [];
  const tail = halves.length === 1 || halves[1] === "" ? [] : halves[1]?.split(":") ?? [];
  const missing = 8 - head.length - tail.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) {
    return undefined;
  }
  const words = [
    ...head,
    ...Array.from({ length: missing }, () => "0"),
    ...tail,
  ].map((word) => Number.parseInt(word || "0", 16));
  if (
    words.length !== 8 ||
    words.some((word) => !Number.isInteger(word) || word < 0 || word > 0xffff)
  ) {
    return undefined;
  }
  return Uint8Array.from(
    words.flatMap((word) => [(word >> 8) & 0xff, word & 0xff]),
  );
}

function bytesStartWith(bytes: Uint8Array, prefix: number[]): boolean {
  return prefix.every((value, index) => bytes[index] === value);
}

function ipv6Private(address: string): boolean {
  const bytes = parseIpv6Bytes(address);
  if (bytes === undefined) {
    return false;
  }
  if (bytes.every((byte) => byte === 0)) {
    return true;
  }
  if (bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1) {
    return true;
  }
  const isMappedIpv4 =
    bytes.slice(0, 10).every((byte) => byte === 0) &&
    bytes[10] === 0xff &&
    bytes[11] === 0xff;
  const isCompatibleIpv4 = bytes.slice(0, 12).every((byte) => byte === 0);
  if (isMappedIpv4 || isCompatibleIpv4) {
    return ipv4Private(
      `${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`,
    );
  }
  if (bytes[0] === 0x20 && bytes[1] === 0x02) {
    return ipv4Private(`${bytes[2]}.${bytes[3]}.${bytes[4]}.${bytes[5]}`);
  }
  return (
    (bytes[0] & 0xfe) === 0xfc ||
    (bytes[0] === 0xfe && (bytes[1]! & 0xc0) === 0x80) ||
    (bytes[0] === 0xfe && (bytes[1]! & 0xc0) === 0xc0) ||
    bytes[0] === 0xff ||
    bytesStartWith(bytes, [0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]) ||
    bytesStartWith(bytes, [0x20, 0x01, 0x00, 0x00]) ||
    bytesStartWith(bytes, [0x20, 0x01, 0x00, 0x02, 0x00, 0x00]) ||
    bytesStartWith(bytes, [0x20, 0x01, 0x0d, 0xb8]) ||
    bytesStartWith(bytes, [0x00, 0x64, 0xff, 0x9b, 0x00, 0x01])
  );
}

export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    return ipv4Private(address);
  }
  if (family === 6) {
    return ipv6Private(address);
  }
  throw new TargetPolicyError("INVALID_TARGET", "DNS returned an invalid IP address.");
}

export function validateResponseSize(
  headers: Record<string, string | undefined>,
  maxResponseBytes: number,
): void {
  const contentLength = Object.entries(headers).find(
    ([name]) => name.toLowerCase() === "content-length",
  )?.[1];
  if (contentLength === undefined) {
    return;
  }
  if (!/^\d+$/.test(contentLength)) {
    throw new TargetPolicyError(
      "TARGET_POLICY_DENIED",
      "Response content length is malformed.",
    );
  }
  const declaredBytes = Number(contentLength);
  if (!Number.isSafeInteger(declaredBytes) || declaredBytes > maxResponseBytes) {
    throw new TargetPolicyError(
      "TARGET_POLICY_DENIED",
      `Response exceeds the ${maxResponseBytes}-byte audit limit.`,
    );
  }
}

export async function validateTarget(
  rawUrl: string,
  policy: "public" | "local-explicit",
  resolver: DnsResolver = defaultResolver,
): Promise<TargetValidation> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new TargetPolicyError("INVALID_TARGET", "Target must be a valid URL.");
  }

  if (url.username || url.password) {
    throw new TargetPolicyError(
      "TARGET_POLICY_DENIED",
      "Embedded URL credentials are not allowed.",
    );
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new TargetPolicyError(
      "TARGET_POLICY_DENIED",
      `Protocol ${url.protocol} is not allowed.`,
    );
  }
  if (policy === "public" && url.protocol !== "https:") {
    throw new TargetPolicyError(
      "TARGET_POLICY_DENIED",
      "Public targets must use HTTPS.",
    );
  }
  if (!url.hostname) {
    throw new TargetPolicyError("INVALID_TARGET", "Target hostname is required.");
  }

  const hostname =
    url.hostname.startsWith("[") && url.hostname.endsWith("]")
      ? url.hostname.slice(1, -1)
      : url.hostname;
  const literalFamily = isIP(hostname);
  const results = literalFamily
    ? [{ address: hostname, family: literalFamily as 4 | 6 }]
    : await resolver(hostname);
  if (results.length === 0) {
    throw new TargetPolicyError("INVALID_TARGET", "Target hostname did not resolve.");
  }

  const addresses = results.map((entry) => entry.address);
  if (policy === "public" && addresses.some(isPrivateAddress)) {
    throw new TargetPolicyError(
      "TARGET_POLICY_DENIED",
      "Public targets cannot resolve to private or special-use addresses.",
    );
  }

  return { url, addresses };
}
