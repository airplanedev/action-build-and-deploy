import * as core from "@actions/core";
import { exec } from "./exec";
import { promises as fs } from "fs";
import { tmpDir } from "./tmp";

async function run(): Promise<void> {
  try {
    await post();
  } catch (error) {
    core.setFailed(error.message);
  }
}

async function post() {
  // Logout from Docker:
  await exec(["docker", "logout", "us-central1-docker.pkg.dev"]);

  // Cleanup the temporary directory:
  await fs.rmdir(await tmpDir(), { recursive: true });
}

run();
