import * as core from "@actions/core";
import * as github from "@actions/github";
import got from "got";
import { exec } from "./exec";
import { promises as fs } from "fs";
import path from "path";
import { tmpDir } from "./tmp";
import { BuildPack, getDockerfile } from "./buildpack";

async function run(): Promise<void> {
  try {
    await main();
  } catch (error) {
    core.setFailed(error.message);
  }
}

async function main() {
  const apiKey: string = core.getInput("api-key");
  // TODO: remove this dependency on the team id
  const teamID: string = core.getInput("team-id");
  const host: string = core.getInput("host");
  // Hardcode the tasks and build-packs for now. For now, we want to show
  // this e2e with our internal scripts.
  //
  // TODO: pull this build-pack data from the API.
  const tasks: Array<{
    taskID: string;
    buildPack: BuildPack;
  }> = JSON.parse(core.getInput("tasks"));

  // Get an Airplane Registry token:
  const resp = await got
    .post(`https://${host}/agent/registry/getToken`, {
      headers: {
        "X-Token": apiKey,
        "X-Team-ID": teamID,
      },
    })
    .json<{
      token: string;
      expiration: string;
      repo: string;
    }>();
  const expiration = new Date(resp.expiration);
  core.debug(`Got Airplane Registry token that expires at: ${expiration}`);

  // Configure Docker to use this token:
  await exec(
    [
      "docker",
      "login",
      "--username",
      "oauth2accesstoken",
      "--password-stdin",
      "us-central1-docker.pkg.dev",
    ],
    {
      input: Buffer.from(resp.token),
    }
  );

  // Create a temporary directory for building all images in.
  await tmpDir();

  // Build and publish each image:
  console.log(`Uploading ${tasks.length} task(s) to Airplane...`);
  await Promise.all(
    // TODO: use a prefix-logger for these parallel builds
    tasks.map((task) => buildTask(task.taskID, task.buildPack, resp.repo))
  );

  console.log('Done. Ready to launch from https://app.airplane.dev 🛫');
  console.log(`Published tasks: ${tasks.map(task => `  - https://app.airplane.dev/tasks/${task.taskID}`)}`)
  console.log(`These tasks can be run with your latest code using any of the following image tags: [${getTags()}]`)
}

async function getTags() {
  // Fetch the shortest unique SHA (of length at least 7):
  const { stdout: shortSHA } = await exec([
    "git", "rev-parse", "--short=7", github.context.sha
  ])

  const branch = sanitizeDockerTag(
    github.context.ref.replace(/^refs\/heads\//, "")
  );

  return [shortSHA, branch];
}

async function buildTask(
  taskID: string,
  bp: BuildPack,
  registry: string
): Promise<void> {
  core.debug(`building taskID='${taskID}'`);

  // Generate a Dockerfile based on the build-pack:
  const dockerfilePath = path.join(await tmpDir(taskID), "Dockerfile");
  const dockerfile = getDockerfile(bp);
  await fs.writeFile(dockerfilePath, dockerfile);
  core.debug(
    `Wrote Dockerfile for taskID=${taskID} to ${dockerfilePath}. Contents: ${dockerfile}`
  );

  const cacheDir = `/tmp/.buildx-cache/${taskID}`
  await fs.mkdir(cacheDir, {
    recursive: true,
  });

  const tags = await getTags()
  await exec([
    "docker",
    "buildx",
    "build",
    ...tags
      .map((tag) => ["--tag", `${registry}/${toImageName(taskID)}:${tag}`])
      .flat(1),
    "--file",
    dockerfilePath,
    "--cache-from",
    `type=local,src=${cacheDir}`,
    "--cache-to",
    `type=local,dest=${cacheDir}`,
    "--push",
    ".",
  ]);

  return;
}

function toImageName(taskID: string) {
  return `task-${taskID.toLowerCase()}`;
}

function sanitizeDockerTag(str: string) {
  // A tag name must be valid ASCII and may contain lowercase and uppercase
  // letters, digits, underscores, periods and dashes. A tag name may not
  // start with a period or a dash and may contain a maximum of 128 characters.
  return str
    .substr(0, 128)
    .replace(/[^a-zA-Z0-9_.-]/, "-")
    .replace(/^[.-]/, "_");
}

run();
