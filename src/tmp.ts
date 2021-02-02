import { promises as fs } from "fs";
import path from "path";
import os from "os";
import * as core from "@actions/core";

export async function tmpDir(subdir?: string): Promise<string> {
  const stateKey = "TMP_DIR";

  let dir = core.getState(stateKey);
  if (!dir) {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "airplane-"));
    core.saveState(stateKey, dir);
  }

  if (!subdir) {
    return dir;
  }

  const fullpath = path.join(dir, subdir);
  await fs.mkdir(fullpath, {
    recursive: true,
  });

  return fullpath;
}
