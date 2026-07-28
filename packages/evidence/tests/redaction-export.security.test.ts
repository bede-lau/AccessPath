import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  createAuditDirectoryLayout,
  createIntegrityManifestHash,
  finalizeAuditBundle,
  NdjsonEventStore,
  persistArtifact,
  persistAuditBundle,
  redactText,
  redactValue,
  regenerateReportsFromPersistedEvidence,
  validateArtifactRoot,
} from "../src/index";
import { bundle, finding } from "./fixtures";
import { event } from "./fixtures";

const temporaryDirectories: string[] = [];

async function roots() {
  const repository = await mkdtemp(join(tmpdir(), "accesspath-redact-repo-"));
  const artifacts = await mkdtemp(join(tmpdir(), "accesspath-redact-root-"));
  temporaryDirectories.push(repository, artifacts);
  return { repository, artifacts };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

describe("redaction security", () => {
  it.each([
    ["Authorization: Bearer top.secret.value", "top.secret.value"],
    ["Cookie: session=very-secret-cookie", "very-secret-cookie"],
    ["password=hunter2", "hunter2"],
    ["formValue: real applicant answer", "real applicant answer"],
    ["https://example.test/?token=query-secret&ok=1", "query-secret"],
    ["github_pat_abcdefghijklmnopqrstuvwxyz123456", "github_pat_"],
    ["sk-abcdefghijklmnopqrstuvwxyz123456", "sk-"],
    ["AKIAIOSFODNN7EXAMPLE", "AKIAIOSFODNN7EXAMPLE"],
    ["C:\\Users\\person\\private\\repo\\file.ts", "person"],
    ["\\\\server\\share\\private\\file.ts", "server"],
    ["/home/person/private/repo/file.ts", "/home/person"],
    ["/workspace/person/private/repo/file.ts", "/workspace/person"],
  ])("redacts %s", (input, secret) => {
    const output = redactText(input);
    expect(output).not.toContain(secret);
    expect(output).toMatch(/\[REDACTED\]|\[LOCAL_PATH\]/);
  });

  it("redacts nested authorization, cookies, passwords, fixture and form values", () => {
    const redacted = redactValue({
      authorization: "Bearer secret",
      headers: { cookie: "session=secret" },
      password: "secret",
      fixtureValues: { email: "private@example.test" },
      formValues: ["one", "two"],
      safe: "visible",
    });
    expect(redacted).toEqual({
      authorization: "[REDACTED]",
      headers: { cookie: "[REDACTED]" },
      password: "[REDACTED]",
      fixtureValues: { email: "[REDACTED]" },
      formValues: ["[REDACTED]", "[REDACTED]"],
      safe: "visible",
    });
  });

  it("redacts persisted bundle fixture values and textual path leakage", () => {
    const finalized = finalizeAuditBundle(
      bundle({
        task: {
          ...bundle().task,
          fixtureValues: {
            password: "actual-password",
            applicant: "C:\\Users\\person\\applicant.json",
          },
        },
        limitations: [
          "Authorization: Bearer bundle-token",
          "Collected at /home/person/private/audit",
        ],
      }),
    );
    const serialized = JSON.stringify(finalized);
    expect(serialized).not.toContain("actual-password");
    expect(serialized).not.toContain("bundle-token");
    expect(serialized).not.toContain("C:\\\\Users\\\\person");
    expect(serialized).not.toContain("/home/person");
  });

  it("redacts event payloads before appending NDJSON", async () => {
    const { artifacts } = await roots();
    const path = join(artifacts, "events.ndjson");
    const store = new NdjsonEventStore(path);
    await store.append(
      event(1, {
        payload: {
          authorization: "Bearer event-secret",
          output: "password=event-password at /workspace/private/file.ts",
        },
      }),
    );
    const persisted = await readFile(path, "utf8");
    expect(persisted).not.toMatch(
      /event-secret|event-password|\/workspace\/private/i,
    );
    expect(persisted).toContain("[REDACTED]");
    expect(persisted).toContain("[LOCAL_PATH]");
  });

  it("redacts textual artifacts before hashing and persistence", async () => {
    const { repository, artifacts } = await roots();
    const root = await validateArtifactRoot(artifacts, repository);
    const layout = await createAuditDirectoryLayout(root, "audit-artifact-redact");
    const artifact = await persistArtifact(layout, {
      kind: "console-summary",
      mimeType: "text/plain",
      sensitivity: "redacted",
      description: "Redacted console output",
      content:
        "Authorization: Bearer artifact-secret\nC:\\Users\\person\\repo\\file.ts",
    });
    const persisted = await readFile(
      join(layout.auditDir, artifact.relativePath),
      "utf8",
    );
    expect(persisted).not.toMatch(/artifact-secret|C:\\Users\\person/i);
    expect(persisted).toContain("[REDACTED]");
    expect(persisted).toContain("[LOCAL_PATH]");
  });
});

describe("export leakage security", () => {
  it("emits no secrets or absolute personal paths in Markdown, HTML, or JSON", async () => {
    const { repository, artifacts } = await roots();
    const root = await validateArtifactRoot(artifacts, repository);
    const layout = await createAuditDirectoryLayout(root, "audit-secure-export");
    await persistAuditBundle(
      layout,
      bundle({
        id: "bundle-secure-export",
        auditSessionId: "audit-secure-export",
        task: {
          ...bundle().task,
          startUrl: "https://fixture.example/start?token=query-secret",
          fixtureValues: {
            password: "actual-password",
            email: "private@example.test",
          },
        },
        findings: [
          finding({
            id: "finding-secure",
            observation:
              "Cookie: session=cookie-secret at C:\\Users\\person\\repo\\app.ts",
            diagnosis: "Authorization: Bearer auth-secret",
            reproduction: ["Open /home/person/private/repo"],
          }),
        ],
        limitations: ["formValue=real-form-value"],
      }),
    );

    const reports = await regenerateReportsFromPersistedEvidence(layout);
    for (const report of Object.values(reports)) {
      expect(report).not.toMatch(
        /query-secret|actual-password|private@example\.test|cookie-secret|auth-secret|real-form-value|C:\\Users\\person|\/home\/person/i,
      );
      expect(report).toContain("[REDACTED]");
      expect(report).toContain("finding-secure");
      expect(report).toContain("observed");
      expect(report).toMatch(/limitations/i);
    }
  });

  it("re-redacts a valid pre-hashed bundle before writing it", async () => {
    const { repository, artifacts } = await roots();
    const root = await validateArtifactRoot(artifacts, repository);
    const layout = await createAuditDirectoryLayout(root, "audit-stamped");
    const unsafeContent = bundle({
      id: "bundle-stamped",
      auditSessionId: "audit-stamped",
      limitations: ["password=stamped-secret"],
    });
    const unsafeStamped = {
      ...unsafeContent,
      integrity: {
        algorithm: "sha256" as const,
        manifestHash: createIntegrityManifestHash(unsafeContent),
      },
    };
    await persistAuditBundle(layout, unsafeStamped);
    expect(await readFile(layout.bundlePath, "utf8")).not.toContain(
      "stamped-secret",
    );
  });
});
