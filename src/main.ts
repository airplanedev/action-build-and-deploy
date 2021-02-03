import * as core from "@actions/core";
import * as github from "@actions/github";
import got from "got";
import { exec } from "./exec";
import { promises as fs } from "fs";
import path from "path";
import { tmpDir } from "./tmp";
import { BuildPack, getDockerfile } from "./buildpack";
import hash from 'object-hash'

async function run(): Promise<void> {
  try {
    await main();
  } catch (error) {
    core.setFailed(error.message);
  }
}

type Task = {
  taskID: string;
  buildPack: BuildPack;
}

async function main() {
  const apiKey: string = core.getInput("api-key");
  // TODO: remove this dependency on the team id
  const teamID: string = core.getInput("team-id");
  const host: string = core.getInput("host");
  const parallel = core.getInput("parallel") === "true";
  // Hardcode the tasks and build-packs for now. For now, we want to show
  // this e2e with our internal scripts.
  //
  // TODO: pull this build-pack data from the API.
  const tasks: Task[] = JSON.parse(core.getInput("tasks"));

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
      input: resp.token,
    }
  );

  // Create a temporary directory for building all images in.
  await tmpDir();

  const tags = await getTags()
  // Group together tasks by build pack, so that we build the minimum number of images.
  const builds: Record<string, { bp: BuildPack, imageTags: string[] }> = {}
  for (const task of tasks) {
    const key = hash(task.buildPack)
    builds[key] = {
      bp: task.buildPack,
      imageTags: [
        ...(builds[key]?.imageTags || []),
        ...tags.map((tag) => `${resp.repo}/${toImageName(task.taskID)}:${tag}`),
      ],
    }
  }

  // Build and publish each image:
  console.log(`Uploading ${tasks.length} task(s) to Airplane...`);
  if (parallel) {
    await Promise.all(
      Object.values(builds).map(build => buildTask(build.bp, build.imageTags))
    );
  } else {
    for (const build of Object.values(builds)) {
      await buildTask(build.bp, build.imageTags)
    }
  }

  console.log('Done. Ready to launch from https://app.airplane.dev 🛫');
  console.log(`Published tasks: ${tasks.map(task => `\n  - https://app.airplane.dev/tasks/${task.taskID}`).join("\n")}`)
  console.log(`These tasks can be run with your latest code using any of the following image tags: [${tags}]`)
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
  bp: BuildPack,
  imageTags: string[]
): Promise<void> {
  core.debug(`${JSON.stringify({bp, imageTags}, null, 2)}`)

  // Generate a Dockerfile based on the build-pack:
  const dir = await tmpDir(hash(bp))
  const dockerfilePath = path.join(dir, "Dockerfile");
  const dockerfile = await getDockerfile(bp);
  await fs.writeFile(dockerfilePath, dockerfile);
  core.debug(`wrote Dockerfile to ${dockerfilePath} with contents: \n${dockerfile}`);

  const cacheDir = `/tmp/.buildx-cache/${hash(bp)}`
  await fs.mkdir(cacheDir, {
    recursive: true,
  });

  const tags = await getTags()
  await exec([
    "docker",
    "buildx",
    "build",
    ...imageTags.map((tag) => ["--tag", tag]).flat(1),
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
