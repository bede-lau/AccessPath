const QODER_AUTH_PATTERNS = [
  /^no qodercli login found\b/i,
  /^qoder_personal_access_token is required\b/i,
  /\bauth_not_configured\b/i,
] as const;

export class QoderAuthenticationError extends Error {
  public readonly code = "QODER_AUTH_REQUIRED";

  public constructor(
    message = "Qoder authentication is required.",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "QoderAuthenticationError";
  }
}

export class QwenAuthenticationError extends QoderAuthenticationError {
  public constructor(
    message = "Qwen authentication is required.",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "QwenAuthenticationError";
  }
}

export class OpenAiAuthenticationError extends QoderAuthenticationError {
  public constructor(
    message = "OpenAI authentication is required.",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "OpenAiAuthenticationError";
  }
}

export function isQoderAuthenticationMessage(message: string): boolean {
  const normalized = message.trim();
  return QODER_AUTH_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function normalizeQoderError(error: unknown): Error {
  if (error instanceof QoderAuthenticationError) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  return isQoderAuthenticationMessage(message)
    ? new QoderAuthenticationError(undefined, {
        cause: error,
      })
    : error instanceof Error
      ? error
      : new Error(message);
}
