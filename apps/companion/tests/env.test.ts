import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/env";

describe("loadEnv", () => {
  it("defaults artifactRoot to ~/.accesspath", () => {
    const config = loadEnv({});
    expect(config.artifactRoot).toBe(path.join(os.homedir(), ".accesspath"));
  });

  it("rejects a relative ACCESSPATH_ARTIFACT_ROOT", () => {
    expect(() => loadEnv({ ACCESSPATH_ARTIFACT_ROOT: "relative/dir" })).toThrow(
      /absolute path/,
    );
  });

  it("accepts an absolute ACCESSPATH_ARTIFACT_ROOT", () => {
    const absolute = path.join(
      os.homedir(),
      "artifacts",
      "..",
      "accesspath-artifacts",
    );
    const config = loadEnv({ ACCESSPATH_ARTIFACT_ROOT: absolute });
    expect(config.artifactRoot).toBe(
      path.join(os.homedir(), "accesspath-artifacts"),
    );
  });

  it("defaults ACCESSPATH_PORT to 0 (OS-selected port)", () => {
    expect(loadEnv({}).port).toBe(0);
  });

  it("rejects every non-loopback host", () => {
    expect(() => loadEnv({ ACCESSPATH_HOST: "0.0.0.0" })).toThrow(
      /127\.0\.0\.1/,
    );
    expect(() => loadEnv({ ACCESSPATH_HOST: "192.168.1.20" })).toThrow(
      /127\.0\.0\.1/,
    );
    expect(() => loadEnv({ ACCESSPATH_HOST: "::1" })).toThrow(/127\.0\.0\.1/);
  });

  it("rejects an artifact root inside the editable repository", () => {
    const repositoryRoot = path.join(os.tmpdir(), "accesspath-repository");
    expect(() =>
      loadEnv(
        {
          ACCESSPATH_ARTIFACT_ROOT: path.join(repositoryRoot, ".accesspath"),
        },
        repositoryRoot,
      ),
    ).toThrow(/outside the editable repository/);
  });

  it("rejects an invalid port string", () => {
    expect(() => loadEnv({ ACCESSPATH_PORT: "not-a-port" })).toThrow(
      /ACCESSPATH_PORT/,
    );
    expect(() => loadEnv({ ACCESSPATH_PORT: "65536" })).toThrow(
      /ACCESSPATH_PORT/,
    );
    expect(() => loadEnv({ ACCESSPATH_PORT: "12.5" })).toThrow(
      /ACCESSPATH_PORT/,
    );
  });

  it("applies remaining defaults without mutating the input", () => {
    const fakeEnv = {};
    const config = loadEnv(fakeEnv);
    expect(config.host).toBe("127.0.0.1");
    expect(config.demoAidAppPort).toBe(4173);
    expect(config.nodeEnv).toBe("development");
    expect(fakeEnv).toEqual({});
  });
});
