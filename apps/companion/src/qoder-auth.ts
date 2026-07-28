import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const SDK_VERSION = "1.0.16";

async function hasCredentialFile(path: string): Promise<boolean> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as unknown;
    return (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      Object.keys(value).length > 0
    );
  } catch {
    return false;
  }
}

export async function qoderAuthAvailability(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<{
  available: boolean;
  strategy?: "pat" | "qodercli";
  sdkVersion: string;
}> {
  if (environment.QODER_PERSONAL_ACCESS_TOKEN?.trim()) {
    return {
      available: true,
      strategy: "pat",
      sdkVersion: SDK_VERSION,
    };
  }
  const configDirectory =
    environment.QODER_CONFIG_DIR ??
    join(environment.QODER_CLI_HOME ?? homedir(), ".qoder");
  const localAuthentication = await hasCredentialFile(
    join(configDirectory, "oauth_creds.json"),
  );
  return {
    available: localAuthentication,
    ...(localAuthentication ? { strategy: "qodercli" as const } : {}),
    sdkVersion: SDK_VERSION,
  };
}
