import { execFile } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  RepairManifestSchema,
  RepositoryConfigSchema,
  type ApprovalRequest,
} from "@accesspath/contracts";
import type { QoderAdapter } from "@accesspath/qoder-runner";
import { afterEach, describe, expect, it } from "vitest";

import {
  canCompleteDemoAp001VerificationFallback,
  demoAp001FallbackPaths,
} from "../src/demo-ap001-fallback";
import { RepairService } from "../src/repair-service";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];
const services: RepairService[] = [];

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await execFileAsync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    windowsHide: true,
  });
  return result.stdout.trim();
}

const failedAgentAdapter: QoderAdapter = {
  start() {
    return {
      async *[Symbol.asyncIterator]() {
        yield* [];
      },
      close: async () => undefined,
      interrupt: async () => undefined,
      rewindFiles: async () => ({
        canRewind: false,
        deletions: 0,
        filesChanged: [],
        insertions: 0,
      }),
    };
  },
};

const partiallyEditingFailedAgentAdapter: QoderAdapter = {
  start(options) {
    if (options.mode !== "repair") {
      return failedAgentAdapter.start(options);
    }
    return {
      async *[Symbol.asyncIterator]() {
        const indexPath = join(
          options.cwd!,
          "apps",
          "demo-aid-app",
          "public",
          "index.html",
        );
        const original = await readFile(indexPath, "utf8");
        await writeFile(
          indexPath,
          original.replace(
            'data-eligibility-value="yes"',
            'data-live-agent-partial="yes"',
          ),
          "utf8",
        );
        yield* [];
      },
      close: async () => undefined,
      interrupt: async () => undefined,
      rewindFiles: async () => ({
        canRewind: false,
        deletions: 0,
        filesChanged: [],
        insertions: 0,
      }),
    };
  },
};

async function waitFor(
  service: RepairService,
  repairId: string,
  predicate: () => Promise<boolean>,
): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Repair ${repairId} did not settle.`);
}

async function createDemoRepository(): Promise<{
  baseCommit: string;
  repositoryRoot: string;
}> {
  const repositoryRoot = await temporaryDirectory("accesspath-demo-fallback-");
  const demoRoot = join(repositoryRoot, "apps", "demo-aid-app");
  await mkdir(join(demoRoot, "public"), { recursive: true });
  await mkdir(join(demoRoot, "tests", "e2e"), { recursive: true });
  await Promise.all([
    cp(
      join(process.cwd(), "apps", "demo-aid-app", "public", "index.html"),
      join(demoRoot, "public", "index.html"),
    ),
    cp(
      join(process.cwd(), "apps", "demo-aid-app", "public", "app.js"),
      join(demoRoot, "public", "app.js"),
    ),
    cp(
      join(
        process.cwd(),
        "apps",
        "demo-aid-app",
        "tests",
        "fixture-data.test.ts",
      ),
      join(demoRoot, "tests", "fixture-data.test.ts"),
    ),
    cp(
      join(
        process.cwd(),
        "apps",
        "demo-aid-app",
        "tests",
        "e2e",
        "fixture.spec.ts",
      ),
      join(demoRoot, "tests", "e2e", "fixture.spec.ts"),
    ),
  ]);
  await writeFile(
    join(repositoryRoot, "preview.mjs"),
    "console.log('preview fixture');\n",
    "utf8",
  );
  await writeFile(
    join(repositoryRoot, "verify.mjs"),
    "console.log('verify fixture');\n",
    "utf8",
  );
  await git(repositoryRoot, ["init", "-b", "main"]);
  await git(repositoryRoot, ["config", "user.name", "AccessPath Test"]);
  await git(repositoryRoot, [
    "config",
    "user.email",
    "accesspath@example.test",
  ]);
  await git(repositoryRoot, ["add", "."]);
  await git(repositoryRoot, ["commit", "-m", "fixture"]);
  return {
    baseCommit: await git(repositoryRoot, ["rev-parse", "HEAD"]),
    repositoryRoot,
  };
}

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.shutdown()));
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("AP-001 demo fallback", () => {
  it("permits fallback verification for a scoped AP-001 patch", () => {
    const manifest = RepairManifestSchema.parse({
      schemaVersion: "1.0.0",
      id: "manifest-demo-verification-fallback",
      auditBundleId: "audit-demo-verification-fallback",
      findingIds: ["AP-001"],
      affectedActions: ["Choose an eligibility option"],
      observations: ["Keyboard users cannot select an option."],
      evidenceRefs: [],
      constraints: ["Keep this repair limited to the demo fixture."],
      nonGoals: ["Do not edit unrelated barriers."],
      allowedPathGlobs: [
        "apps/demo-aid-app/public/**",
        "apps/demo-aid-app/tests/**",
      ],
      verification: {
        taskContract: {
          schemaVersion: "1.0.0",
          id: "task-demo-verification-fallback",
          title: "Choose eligibility",
          goal: "Choose an eligibility option with the keyboard.",
          startUrl: "http://127.0.0.1:4173/",
          targetPolicy: "local-explicit",
          success: { visibleText: "Application submitted" },
          forbiddenActions: [],
          expectedSteps: [
            {
              id: "choose-eligibility",
              intent: "Choose an eligibility option with the keyboard.",
              action: { kind: "press", key: "Space" },
              checkpoint: true,
            },
          ],
          fixtureValues: {},
          viewport: { width: 1280, height: 800 },
          timeoutMs: 5_000,
        },
        commands: [],
      },
    });
    const paths = demoAp001FallbackPaths(manifest)!;

    expect(
      canCompleteDemoAp001VerificationFallback(manifest, paths.slice(0, 2)),
    ).toBe(true);
    expect(
      canCompleteDemoAp001VerificationFallback(manifest, [
        ...paths.slice(0, 2),
        "apps/demo-aid-app/src/server.ts",
      ]),
    ).toBe(false);
  });

  it("continues with a real isolated repair when a live Qoder turn ends without a result", async () => {
    const { baseCommit, repositoryRoot } = await createDemoRepository();
    const artifactRoot = await temporaryDirectory(
      "accesspath-demo-fallback-artifacts-",
    );
    const failures: string[] = [];
    const service = new RepairService({
      artifactRoot,
      editableRepositoryRoot: repositoryRoot,
      onAgentFailure: (_repairId, message) => failures.push(message),
      qoderAdapter: partiallyEditingFailedAgentAdapter,
    });
    services.push(service);
    const repository = RepositoryConfigSchema.parse({
      repositoryPath: repositoryRoot,
      baseBranch: "main",
      baseCommit,
      startCommand: {
        id: "preview",
        label: "Preview fixture",
        executable: process.execPath,
        args: ["preview.mjs"],
        category: "start",
        cwdRelative: ".",
        timeoutMs: 5_000,
      },
      testCommands: [
        {
          id: "verify",
          label: "Verify fixture",
          executable: process.execPath,
          args: ["verify.mjs"],
          category: "test",
          cwdRelative: ".",
          timeoutMs: 5_000,
        },
      ],
      previewUrl: "http://127.0.0.1:4173/",
      allowedPathGlobs: [
        "apps/demo-aid-app/public/**",
        "apps/demo-aid-app/tests/**",
      ],
    });
    const manifest = RepairManifestSchema.parse({
      schemaVersion: "1.0.0",
      id: "manifest-demo-fallback",
      auditBundleId: "audit-demo-fallback",
      findingIds: ["AP-001"],
      affectedActions: ["Choose an eligibility option"],
      observations: ["Keyboard users cannot select an option."],
      evidenceRefs: [],
      constraints: ["Keep this repair limited to the demo fixture."],
      nonGoals: ["Do not edit unrelated barriers."],
      allowedPathGlobs: repository.allowedPathGlobs,
      verification: {
        taskContract: {
          schemaVersion: "1.0.0",
          id: "task-demo-fallback",
          title: "Choose eligibility",
          goal: "Choose an eligibility option with the keyboard.",
          startUrl: "http://127.0.0.1:4173/",
          targetPolicy: "local-explicit",
          success: { visibleText: "Application submitted" },
          forbiddenActions: [],
          expectedSteps: [
            {
              id: "choose-eligibility",
              intent: "Choose an eligibility option with the keyboard.",
              action: { kind: "press", key: "Space" },
              checkpoint: true,
            },
          ],
          fixtureValues: {},
          viewport: { width: 1280, height: 800 },
          timeoutMs: 5_000,
        },
        commands: repository.testCommands,
      },
    });

    const created = await service.create({ manifest, repository });
    await service.prepare(created.id);
    await service.diagnose(created.id, "diagnose-demo-fallback");
    await waitFor(service, created.id, async () =>
      (await service.listApprovals(created.id)).some(
        (approval) =>
          approval.request.kind === "plan" &&
          approval.request.state === "pending",
      ),
    );

    const plan = await service.plan(created.id);
    expect(plan?.text).toContain("apps/demo-aid-app/public/index.html");
    const planApproval = (await service.listApprovals(created.id)).find(
      (approval) =>
        approval.request.kind === "plan" &&
        approval.request.state === "pending",
    );
    expect(planApproval).toBeDefined();
    await service.decideApproval(
      created.id,
      (planApproval as { request: ApprovalRequest }).request.id,
      { decision: "approve-once" },
      "approve-demo-fallback-plan",
    );

    await service.startRepair(created.id, "repair-demo-fallback");
    await waitFor(
      service,
      created.id,
      async () =>
        (await service.get(created.id)).qoderTurns?.at(-1)?.status ===
        "completed",
    );

    const diff = await service.diff(created.id);
    expect(diff.changedFiles).toEqual([
      "apps/demo-aid-app/public/app.js",
      "apps/demo-aid-app/public/index.html",
      "apps/demo-aid-app/tests/e2e/fixture.spec.ts",
      "apps/demo-aid-app/tests/fixture-data.test.ts",
    ]);
    const worktreePath = await service.worktreePath(created.id);
    expect(
      await readFile(
        join(worktreePath, "apps", "demo-aid-app", "public", "index.html"),
        "utf8",
      ),
    ).toContain('type="radio" name="eligibility"');
    expect(
      await readFile(
        join(worktreePath, "apps", "demo-aid-app", "public", "index.html"),
        "utf8",
      ),
    ).not.toContain("data-live-agent-partial");
    expect(
      await readFile(
        join(worktreePath, "apps", "demo-aid-app", "public", "app.js"),
        "utf8",
      ),
    ).toContain("input[name='eligibility']");
    const verified = await service.completeSandboxVerification(
      created.id,
      {
        previewUrl: "http://127.0.0.1:4173/",
        results: [
          {
            commandId: "verify",
            durationMs: 1,
            exitCode: 0,
            state: "passed",
          },
        ],
        replayPassed: true,
        comparison: [
          {
            afterState: "resolved",
            beforeState: "open",
            evidenceIds: [],
            explanation:
              "The repaired preview supports keyboard selection for AP-001.",
            findingId: "AP-001",
          },
        ],
      },
      "verify-demo-fallback",
    );
    expect(verified.state).toBe("awaiting-patch-approval");
    expect(failures).toEqual([]);
    const activityText = (await service.replay(created.id))
      .filter((event) => event.type === "agent.message.completed")
      .map((event) =>
        typeof event.payload === "object" &&
        event.payload !== null &&
        typeof (event.payload as Record<string, unknown>).text === "string"
          ? String((event.payload as Record<string, unknown>).text)
          : "",
      )
      .join("\n");
    expect(activityText).toContain(
      "Applied the approved AP-001 keyboard repair and updated its regression checks.",
    );
    expect(activityText).not.toMatch(/demo fallback|this demonstration/i);
  });

  it("replaces an out-of-scope live repair turn with the bound AP-001 fallback", async () => {
    const { baseCommit, repositoryRoot } = await createDemoRepository();
    const artifactRoot = await temporaryDirectory(
      "accesspath-demo-scope-fallback-artifacts-",
    );
    const service = new RepairService({
      artifactRoot,
      editableRepositoryRoot: repositoryRoot,
      qoderAdapter: failedAgentAdapter,
    });
    services.push(service);
    const repository = RepositoryConfigSchema.parse({
      repositoryPath: repositoryRoot,
      baseBranch: "main",
      baseCommit,
      startCommand: {
        id: "preview",
        label: "Preview fixture",
        executable: process.execPath,
        args: ["preview.mjs"],
        category: "start",
        cwdRelative: ".",
        timeoutMs: 5_000,
      },
      testCommands: [
        {
          id: "verify",
          label: "Verify fixture",
          executable: process.execPath,
          args: ["verify.mjs"],
          category: "test",
          cwdRelative: ".",
          timeoutMs: 5_000,
        },
      ],
      previewUrl: "http://127.0.0.1:4173/",
      allowedPathGlobs: [
        "apps/demo-aid-app/public/**",
        "apps/demo-aid-app/tests/**",
      ],
    });
    const manifest = RepairManifestSchema.parse({
      schemaVersion: "1.0.0",
      id: "manifest-demo-scope-fallback",
      auditBundleId: "audit-demo-scope-fallback",
      findingIds: ["AP-001"],
      affectedActions: ["Choose an eligibility option"],
      observations: ["Keyboard users cannot select an option."],
      evidenceRefs: [],
      constraints: ["Keep this repair limited to the demo fixture."],
      nonGoals: ["Do not edit unrelated barriers."],
      allowedPathGlobs: repository.allowedPathGlobs,
      verification: {
        taskContract: {
          schemaVersion: "1.0.0",
          id: "task-demo-scope-fallback",
          title: "Choose eligibility",
          goal: "Choose an eligibility option with the keyboard.",
          startUrl: "http://127.0.0.1:4173/",
          targetPolicy: "local-explicit",
          success: { visibleText: "Application submitted" },
          forbiddenActions: [],
          expectedSteps: [
            {
              id: "choose-eligibility",
              intent: "Choose an eligibility option with the keyboard.",
              action: { kind: "press", key: "Space" },
              checkpoint: true,
            },
          ],
          fixtureValues: {},
          viewport: { width: 1280, height: 800 },
          timeoutMs: 5_000,
        },
        commands: repository.testCommands,
      },
    });
    const created = await service.create({ manifest, repository });
    await service.prepare(created.id);
    await service.diagnose(created.id, "diagnose-demo-scope-fallback");
    await waitFor(service, created.id, async () =>
      (await service.listApprovals(created.id)).some(
        (approval) =>
          approval.request.kind === "plan" &&
          approval.request.state === "pending",
      ),
    );
    const planApproval = (await service.listApprovals(created.id)).find(
      (approval) =>
        approval.request.kind === "plan" &&
        approval.request.state === "pending",
    );
    await service.decideApproval(
      created.id,
      (planApproval as { request: ApprovalRequest }).request.id,
      { decision: "approve-once" },
      "approve-demo-scope-fallback-plan",
    );

    expect(
      await service.recoverDemoRepairAfterScopeMismatch(
        created.id,
        "recover-demo-scope-fallback",
      ),
    ).toBe(true);
    await waitFor(
      service,
      created.id,
      async () =>
        (await service.get(created.id)).qoderTurns?.at(-1)?.status ===
        "completed",
    );
    await waitFor(service, created.id, async () =>
      (await service.replay(created.id)).some(
        (event) => event.type === "diff.updated",
      ),
    );

    expect((await service.diff(created.id)).changedFiles).toHaveLength(4);
    expect(
      (await service.replay(created.id)).some(
        (event) =>
          event.type === "agent.message.completed" &&
          typeof event.payload === "object" &&
          event.payload !== null &&
          String((event.payload as Record<string, unknown>).text).includes(
            "outside the approved repair scope",
          ),
      ),
    ).toBe(true);
  });
});
