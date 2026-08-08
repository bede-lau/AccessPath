import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { qoderAuthAvailability } from "../src/qoder-auth";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "accesspath-qoder-auth-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("qoder authentication readiness", () => {
  it("prefers a configured personal access token", async () => {
    await expect(
      qoderAuthAvailability({
        QODER_PERSONAL_ACCESS_TOKEN: "configured",
      }),
    ).resolves.toMatchObject({
      available: true,
      strategy: "pat",
      sdkVersion: "1.0.16",
    });
  });

  it("does not treat the machine identity directory as a login", async () => {
    const configDirectory = await temporaryDirectory();
    await mkdir(join(configDirectory, ".auth"), { recursive: true });
    await writeFile(join(configDirectory, ".auth", "machine_id"), "machine");

    await expect(
      qoderAuthAvailability({ QODER_CONFIG_DIR: configDirectory }),
    ).resolves.toEqual({
      available: false,
      sdkVersion: "1.0.16",
    });
  });

  it("recognizes a nonempty qodercli credential document", async () => {
    const configDirectory = await temporaryDirectory();
    await writeFile(
      join(configDirectory, "oauth_creds.json"),
      JSON.stringify({ credential: "present" }),
    );

    await expect(
      qoderAuthAvailability({ QODER_CONFIG_DIR: configDirectory }),
    ).resolves.toMatchObject({
      available: true,
      strategy: "qodercli",
    });
  });

  it("recognizes the current qodercli local credential file", async () => {
    const configDirectory = await temporaryDirectory();
    await mkdir(join(configDirectory, ".auth"), { recursive: true });
    await writeFile(join(configDirectory, ".auth", "user"), "credential");

    await expect(
      qoderAuthAvailability({ QODER_CONFIG_DIR: configDirectory }),
    ).resolves.toMatchObject({
      available: true,
      strategy: "qodercli",
    });
  });

  it("fails closed for missing, empty, or malformed credential documents", async () => {
    const configDirectory = await temporaryDirectory();
    await writeFile(join(configDirectory, "oauth_creds.json"), "{}");
    await expect(
      qoderAuthAvailability({ QODER_CONFIG_DIR: configDirectory }),
    ).resolves.toMatchObject({ available: false });

    await writeFile(join(configDirectory, "oauth_creds.json"), "not-json");
    await expect(
      qoderAuthAvailability({ QODER_CONFIG_DIR: configDirectory }),
    ).resolves.toMatchObject({ available: false });
  });
});
