const SECRET_PATTERNS = [
  /\b(?:authorization|cookie|set-cookie)\s*[:=]\s*(?:bearer\s+)?[^\s,;]+/gi,
  /\b(password|passwd|token|secret|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi,
  /[?&](?:token|key|secret|password)=[^&#\s]+/gi,
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
];

export function redactSummary(value: string, fixtureValues: string[] = []): string {
  let redacted = value;
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, "[REDACTED]");
  }
  for (const secret of fixtureValues.filter((item) => item.length > 0)) {
    redacted = redacted.split(secret).join("[REDACTED]");
  }
  return redacted.slice(0, 1000);
}
