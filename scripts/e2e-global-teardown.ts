import { rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

async function removeOwned(path: string): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await rm(path, { recursive: true, force: true });
      return;
    } catch (error) {
      if (
        attempt === 7 ||
        !["EBUSY", "EACCES", "EPERM"].includes(
          (error as NodeJS.ErrnoException).code ?? "",
        )
      ) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 50 * 2 ** attempt));
    }
  }
}

export default async function globalTeardown(): Promise<void> {
  const root = join(homedir(), ".accesspath");
  await Promise.all([
    removeOwned(join(root, "e2e-runtime")),
    removeOwned(join(root, "e2e-repository")),
  ]);
}
