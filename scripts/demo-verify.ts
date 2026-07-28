import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  RepairManifestSchema,
  RepositoryConfigSchema,
  TaskContractSchema,
  type ApprovalRequest,
} from "@accesspath/contracts";
import {
  fileExists,
  resolveSafeRelativePath,
  validateArtifactRoot,
} from "@accesspath/evidence";
import {
  cleanupWorkspace,
  type PreparedWorkspace,
} from "@accesspath/git-workspace";
import { DeterministicMockQoderAdapter } from "@accesspath/qoder-runner";

import { createServer, stop as stopCompanion } from "../apps/companion/src/server";
import {
  fixtureTaskContract,
  start as startFixture,
  stop as stopFixture,
} from "../apps/demo-aid-app/src/index";
import { p07MockEdits, p07MockWrites } from "./p07-repair-fixture";

const execute = promisify(execFile);
const codeRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const repoRoot = path.resolve(
  process.env.ACCESSPATH_DEMO_REPOSITORY_ROOT ?? codeRoot,
);
const requestedArtifactRoot =
  process.env.ACCESSPATH_ARTIFACT_ROOT ??
  path.join(homedir(), ".accesspath", "demo");
const artifactRoot = await validateArtifactRoot(
  requestedArtifactRoot,
  codeRoot,
);
await validateArtifactRoot(requestedArtifactRoot, repoRoot);
const launchToken = randomBytes(24).toString("base64url");
const headers = {
  host: "127.0.0.1:4801",
  authorization: `Bearer ${launchToken}`,
};

async function git(args: string[]): Promise<string> {
  const result = await execute("git", ["-C", repoRoot, ...args], {
    encoding: "utf8",
    windowsHide: true,
  });
  return result.stdout.trim();
}

async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  const port =
    typeof address === "object" && address !== null ? address.port : 0;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

async function waitForRepairState(
  companion: ReturnType<typeof createServer>,
  repairId: string,
  expected: string,
) {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const response = await companion.inject({
      method: "GET",
      url: `/api/repairs/${repairId}`,
      headers,
    });
    const resource = response.json();
    if (resource.repair.state === expected) {
      return resource;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Repair did not reach ${expected}.`);
}

async function approvePending(
  companion: ReturnType<typeof createServer>,
  repairId: string,
  kind: ApprovalRequest["kind"],
): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const resource = (
      await companion.inject({
        method: "GET",
        url: `/api/repairs/${repairId}`,
        headers,
      })
    ).json();
    const pending = resource.approvals.find(
      (record: { request: ApprovalRequest }) =>
        record.request.kind === kind &&
        record.request.state === "pending",
    ) as { request: ApprovalRequest } | undefined;
    if (pending !== undefined) {
      const decision = await companion.inject({
        method: "POST",
        url: `/api/approvals/${pending.request.id}/decision`,
        headers: {
          ...headers,
          "idempotency-key": `demo-${pending.request.id}`,
        },
        payload: { decision: "approve-once" },
      });
      if (decision.statusCode !== 200) {
        throw new Error(decision.body);
      }
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`No pending ${kind} approval appeared.`);
}

async function portIsClosed(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(port, "127.0.0.1");
    socket.once("connect", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(true));
    socket.setTimeout(1_000, () => {
      socket.destroy();
      resolve(true);
    });
  });
}

const baseCommit = await git(["rev-parse", "HEAD"]);
const baseBranch = await git(["branch", "--show-current"]);
const baseStatus = await git(["status", "--porcelain"]);
if (baseStatus !== "") {
  throw new Error("demo:verify requires a clean base checkout.");
}

const fixture = await startFixture(0);
const fixtureAddress = fixture.address();
if (typeof fixtureAddress !== "object" || fixtureAddress === null) {
  throw new Error("The emergency-aid fixture did not expose a TCP address.");
}
const previewPort = await freePort();
const companion = createServer({
  launchToken,
  artifactRoot,
  editableRepositoryRoot: repoRoot,
  demoAidAppPort: fixtureAddress.port,
  qoderAdapter: new DeterministicMockQoderAdapter({
    diagnosis:
      "Replace the pointer-only AP-001 choices with native radios and add one focused regression test.",
    edits: p07MockEdits,
    writes: p07MockWrites,
    repairSummary:
      "Applied the approved AP-001 native-radio repair and regression test.",
  }),
});
let repairIdForCleanup: string | undefined;

try {
  const task = TaskContractSchema.parse({
    ...fixtureTaskContract,
    startUrl: `http://127.0.0.1:${fixtureAddress.port}/`,
  });
  const createdAudit = await companion.inject({
    method: "POST",
    url: "/api/audits",
    headers,
    payload: { task },
  });
  const auditId = createdAudit.json().audit.id as string;
  await companion.inject({
    method: "POST",
    url: `/api/audits/${auditId}/start`,
    headers,
  });
  let auditState = "";
  for (let attempt = 0; attempt < 800; attempt += 1) {
    auditState = (
      await companion.inject({
        method: "GET",
        url: `/api/audits/${auditId}`,
        headers,
      })
    ).json().audit.state;
    if (["completed", "blocked", "failed", "cancelled"].includes(auditState)) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (auditState !== "blocked") {
    throw new Error(`Expected the inaccessible audit to be blocked, got ${auditState}.`);
  }
  const beforeBundle = (
    await companion.inject({
      method: "GET",
      url: `/api/audits/${auditId}/bundle`,
      headers,
    })
  ).json();
  const beforeIds = beforeBundle.findings.map((finding: { id: string }) => finding.id);
  if (JSON.stringify(beforeIds) !== JSON.stringify(["AP-001", "AP-002", "AP-003", "AP-004", "AP-005"])) {
    throw new Error(`Unexpected before finding IDs: ${beforeIds.join(", ")}`);
  }

  const selected = beforeBundle.findings[0];
  const testCommand = {
    id: "verify-ap-001",
    label: "Verify AP-001 native radio repair",
    executable: process.execPath,
    args: ["apps/demo-aid-app/tests/ap001-repair.mjs"],
    cwdRelative: ".",
    timeoutMs: 30_000,
    category: "test",
  } as const;
  const repository = RepositoryConfigSchema.parse({
    repositoryPath: path.join(repoRoot, "apps", "demo-aid-app"),
    baseBranch,
    baseCommit,
    startCommand: {
      id: "preview-emergency-aid",
      label: "Start repaired emergency-aid preview",
      executable: process.execPath,
      args: ["apps/demo-aid-app/scripts/start-preview.mjs"],
      cwdRelative: ".",
      timeoutMs: 120_000,
      category: "start",
    },
    testCommands: [testCommand],
    previewUrl: `http://127.0.0.1:${previewPort}/`,
    allowedPathGlobs: ["apps/demo-aid-app/**"],
  });
  const manifest = RepairManifestSchema.parse({
    schemaVersion: "1.0.0",
    id: "manifest-demo-ap-001",
    auditBundleId: beforeBundle.id,
    findingIds: ["AP-001"],
    affectedActions: [selected.affectedAction],
    observations: [selected.observation],
    evidenceRefs: beforeBundle.artifacts.filter((artifact: { id: string }) =>
      selected.evidenceIds.includes(artifact.id),
    ),
    constraints: [
      "Change only apps/demo-aid-app/** in the isolated worktree.",
      "Keep AP-002 through AP-005 intentionally present.",
    ],
    nonGoals: ["Do not repair unrelated findings."],
    allowedPathGlobs: ["apps/demo-aid-app/**"],
    verification: { taskContract: task, commands: [testCommand] },
  });
  const createdRepair = await companion.inject({
    method: "POST",
    url: "/api/repairs",
    headers,
    payload: { repository, manifest },
  });
  if (createdRepair.statusCode !== 201) {
    throw new Error(createdRepair.body);
  }
  const repairId = createdRepair.json().repair.id as string;
  repairIdForCleanup = repairId;
  await companion.inject({
    method: "POST",
    url: `/api/repairs/${repairId}/prepare`,
    headers,
  });
  await companion.inject({
    method: "POST",
    url: `/api/repairs/${repairId}/diagnose`,
    headers,
  });
  await waitForRepairState(companion, repairId, "awaiting-plan-approval");
  await approvePending(companion, repairId, "plan");
  await companion.inject({
    method: "POST",
    url: `/api/repairs/${repairId}/start`,
    headers,
  });
  await approvePending(companion, repairId, "tool");
  await approvePending(companion, repairId, "tool");
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const diff = (
      await companion.inject({
        method: "GET",
        url: `/api/repairs/${repairId}/diff`,
        headers,
      })
    ).json().diff;
    if (
      diff.changedFiles.includes("apps/demo-aid-app/public/index.html") &&
      diff.changedFiles.includes("apps/demo-aid-app/tests/ap001-repair.mjs")
    ) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  const verified = await companion.inject({
    method: "POST",
    url: `/api/repairs/${repairId}/verify`,
    headers: { ...headers, "idempotency-key": `verify-${repairId}` },
  });
  if (
    verified.statusCode !== 202 ||
    verified.json().repair.state !== "awaiting-patch-approval"
  ) {
    throw new Error(verified.body);
  }
  const resource = (
    await companion.inject({
      method: "GET",
      url: `/api/repairs/${repairId}`,
      headers,
    })
  ).json();
  const comparison = Object.fromEntries(
    resource.verification.comparison.map(
      (item: { findingId: string; afterState: string }) => [
        item.findingId,
        item.afterState,
      ],
    ),
  );
  if (comparison["AP-001"] !== "resolved") {
    throw new Error("AP-001 was not resolved by browser replay.");
  }
  for (const id of ["AP-002", "AP-003", "AP-004", "AP-005"]) {
    if (comparison[id] !== "remaining") {
      throw new Error(`${id} was not preserved as a remaining finding.`);
    }
  }

  const reports: Record<string, string> = {};
  for (const format of ["html", "markdown", "json"] as const) {
    const response = await companion.inject({
      method: "GET",
      url: `/api/repairs/${repairId}/report?format=${format}`,
      headers,
    });
    if (response.statusCode !== 200) {
      throw new Error(response.body);
    }
    reports[format] = response.body;
  }
  const forbidden = [
    repoRoot,
    artifactRoot,
    homedir(),
    "oauth_creds",
    "authorization",
  ];
  for (const [format, report] of Object.entries(reports)) {
    if (
      forbidden.some((value) => report.toLowerCase().includes(value.toLowerCase())) ||
      /[A-Za-z]:\\Users\\/i.test(report)
    ) {
      throw new Error(`${format} report exposed a secret or absolute personal path.`);
    }
    if (!report.includes("AP-001") || !report.includes("resolved")) {
      throw new Error(`${format} report omitted the verified AP-001 result.`);
    }
  }

  const rewind = await companion.inject({
    method: "POST",
    url: `/api/repairs/${repairId}/rewind/preview`,
    headers: { ...headers, "idempotency-key": `rewind-${repairId}` },
  });
  if (
    rewind.statusCode !== 200 ||
    !rewind.json().preview.affectedFiles.includes(
      "apps/demo-aid-app/public/index.html",
    ) ||
    !rewind.json().preview.affectedFiles.includes(
      "apps/demo-aid-app/tests/ap001-repair.mjs",
    )
  ) {
    throw new Error("Rewind preview did not include the AP-001 source and test.");
  }

  if (
    (await git(["rev-parse", "HEAD"])) !== baseCommit ||
    (await git(["status", "--porcelain"])) !== ""
  ) {
    throw new Error("The base checkout changed during repair and replay.");
  }
  console.log(
    `demo:verify: PASS ${beforeIds.join(", ")} -> AP-001 resolved; AP-002 through AP-005 remaining`,
  );
} finally {
  await Promise.allSettled([
    stopCompanion(companion),
    stopFixture(fixture),
  ]);
  if (repairIdForCleanup !== undefined) {
    const workspacePath = resolveSafeRelativePath(
      artifactRoot,
      `repairs/${repairIdForCleanup}/workspace.private.json`,
    );
    if (await fileExists(workspacePath)) {
      const workspace = JSON.parse(
        await readFile(workspacePath, "utf8"),
      ) as PreparedWorkspace;
      await cleanupWorkspace(workspace, { force: true });
    }
  }
}

for (let attempt = 0; attempt < 50; attempt += 1) {
  if (await portIsClosed(previewPort)) {
    process.exit(0);
  }
  await new Promise((resolve) => setTimeout(resolve, 50));
}
throw new Error("The generated repair preview process did not terminate.");
