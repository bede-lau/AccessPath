const REDACTED = "[REDACTED]";
const PATH_REDACTED = "[LOCAL_PATH]";

const SENSITIVE_KEY =
  /(?:authorization|proxy-authorization|cookie|set-cookie|password|passwd|secret|token|api[-_]?key|client[-_]?secret|form[-_]?values?|fixture[-_]?values?|submitted[-_]?values?)/i;

const TEXT_PATTERNS: Array<[RegExp, string]> = [
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, `$1 ${REDACTED}`],
  [
    /\b(authorization|proxy-authorization|cookie|set-cookie)\s*[:=]\s*[^\r\n]+/gi,
    `$1: ${REDACTED}`,
  ],
  [
    /\b(password|passwd|secret|api[-_]?key|client[-_]?secret)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
    `$1=${REDACTED}`,
  ],
  [/\b(form[-_]?value)\s*[:=]\s*[^\r\n,;]+/gi, `$1=${REDACTED}`],
  [/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, REDACTED],
  [/\b(?:sk-|npm_|xox[baprs]-)[A-Za-z0-9_-]{16,}\b/g, REDACTED],
  [/\bAKIA[0-9A-Z]{16}\b/g, REDACTED],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, REDACTED],
  [
    /([?&](?:access_token|auth|authorization|api_key|apikey|key|password|secret|token)=)[^&#\s]*/gi,
    `$1${REDACTED}`,
  ],
  [/\b[A-Za-z]:[\\/](?:[^<>:"|?*\r\n]+[\\/]?)+/g, PATH_REDACTED],
  [/(^|[\s"'(])\\\\[^\\\s]+\\[^\\\s]+(?:\\[^\s"',;)]+)*/g, `$1${PATH_REDACTED}`],
  [
    /(^|[\s"'(])\/(?:Users|home|root|etc|opt|srv|workspace|mnt|Volumes|var\/folders|private\/var|tmp)\/[^\s"',;)]+/g,
    `$1${PATH_REDACTED}`,
  ],
];

export function redactText(value: string): string {
  return TEXT_PATTERNS.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    value,
  );
}

export function redactValue<T>(value: T): T {
  if (typeof value === "string") {
    return redactText(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(entry)) as T;
  }
  if (value !== null && typeof value === "object") {
    const redacted: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      redacted[key] = SENSITIVE_KEY.test(key)
        ? typeof entry === "object" && entry !== null
          ? redactSensitiveShape(entry)
          : REDACTED
        : redactValue(entry);
    }
    return redacted as T;
  }
  return value;
}

function redactSensitiveShape(value: object): unknown {
  if (Array.isArray(value)) {
    return value.map(() => REDACTED);
  }
  return Object.fromEntries(Object.keys(value).map((key) => [key, REDACTED]));
}

export function containsSensitiveData(value: string): boolean {
  const redacted = redactText(value);
  return redacted !== value;
}
