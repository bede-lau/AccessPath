import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_GIT_OUTPUT_BYTES = 32 * 1024 * 1024;

export class GitCommandError extends Error {
  public constructor(
    message: string,
    public readonly stderr: string,
    public readonly exitCode?: number,
  ) {
    super(message);
  }
}

export async function git(
  cwd: string,
  args: readonly string[],
  options: { allowFailure?: boolean; timeoutMs?: number } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await execFileAsync(
      "git",
      ["-c", "core.quotepath=false", "-C", cwd, ...args],
      {
        encoding: "utf8",
        maxBuffer: MAX_GIT_OUTPUT_BYTES,
        timeout: options.timeoutMs ?? 30_000,
        windowsHide: true,
      },
    );
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      code?: number | string;
    };
    const stderr = failure.stderr ?? "";
    const exitCode =
      typeof failure.code === "number" ? failure.code : undefined;
    if (options.allowFailure) {
      return {
        stdout: failure.stdout ?? "",
        stderr,
        exitCode: exitCode ?? 1,
      };
    }
    throw new GitCommandError(
      stderr.trim() || "Git command failed.",
      stderr,
      exitCode,
    );
  }
}
