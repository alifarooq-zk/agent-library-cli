import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface TestBareRepo {
  bareRepoPath: string;
  commitSha: string;
  cleanup: () => void;
}

export async function createTestBareRepo(
  sourceDir: string,
): Promise<TestBareRepo> {
  const work = mkdtempSync(join(tmpdir(), "al-work-"));
  const sourceContents = `${sourceDir}/.`;
  await Bun.$`git -C ${work} init --initial-branch main`.quiet();
  await Bun.$`git -C ${work} config user.email "test@test.com"`.quiet();
  await Bun.$`git -C ${work} config user.name "Test"`.quiet();
  await Bun.$`cp -R ${sourceContents} ${work}`.quiet();
  await Bun.$`git -C ${work} add -A`.quiet();
  await Bun.$`git -C ${work} commit -m "init"`.quiet();
  const commitSha = (await Bun.$`git -C ${work} rev-parse HEAD`.text()).trim();
  const bareRepoPath = `${work}-bare.git`;
  await Bun.$`git clone --bare ${work} ${bareRepoPath}`.quiet();
  rmSync(work, { recursive: true });

  return {
    bareRepoPath,
    commitSha,
    cleanup: () => rmSync(bareRepoPath, { recursive: true, force: true }),
  };
}
