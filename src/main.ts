import * as core from "@actions/core";
import * as github from "@actions/github";
import got from "got";
import { exec } from "./exec";
import { promises as fs } from "fs";
import path from "path";
import { tmpDir } from "./tmp";
import { getDockerfile, Builder } from './buildpack';
import hash from 'object-hash'

async function run(): Promise<void> {
  try {
    await main();
  } catch (error) {
    core.setFailed(error.message);
  }
}

async function main() {
  core.debug(`Triggered run for context=${JSON.stringify(github.context, null, 2)}`)

  const apiKey: string = core.getInput("api-key");
  // TODO: remove this dependency on the team id
  const teamID: string = core.getInput("team-id");
  const host: string = core.getInput("host");
  const parallel = core.getInput("parallel") === "true";
  const rawBuildArgs = core.getInput("build-args");
  const buildArgs = rawBuildArgs.split('\n').map(arg => arg.trim()).filter(arg => arg !== "")
  core.debug(`got rawBuildArgs='${rawBuildArgs}' translated into buildArgs=${buildArgs}`)
  const tasks = await getTasks(host, apiKey, teamID);

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
  const builds: Record<string, { b: Builder, imageTags: string[] }> = {}
  for (const task of tasks) {
    const b = {
      builder: task.builder,
      builderConfig: task.builderConfig,
    } as Builder
    const key = hash(b)
    builds[key] = {
      b,
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
      Object.values(builds).map(build => buildTask(build.b, build.imageTags, buildArgs))
    );
  } else {
    for (const build of Object.values(builds)) {
      await buildTask(build.b, build.imageTags, buildArgs)
    }
  }

  console.log('Done. Ready to launch from https://app.airplane.dev 🛫');
  console.log(`Published tasks: \n${tasks.map(task => `  - https://app.airplane.dev/tasks/${task.taskID}`).join("\n")}`)
  console.log(`These tasks can be run with your latest code using any of the following image tags: [${tags}]`)
}

async function getTags() {
  // Fetch the shortest unique SHA (of length at least 7):
  const { stdout: shortSHA } = await exec([
    "git", "rev-parse", "--short=7", github.context.sha
  ])

  const branch = github.context.ref.replace(/^refs\/heads\//, "")
  const sanitizedBranch = sanitizeDockerTag(branch);

  const tags = [shortSHA, sanitizedBranch]

  const defaultBranch = github.context.payload.repository?.default_branch
  // The default branch should always be available, it just isn't included as a TS type above.
  // However, as a safety, I'm including a backup of some standard default branches:
  const defaultBranches = defaultBranch == null ? ["main", "master"] : [defaultBranch]
  core.debug(`Publishing :latest if defaultBranch=${defaultBranch} (-> ${defaultBranches}) is branch=${branch}`)
  if (defaultBranches.includes(branch)) {
    tags.push("latest")
  }

  return tags;
}

type Task = Builder & {
  taskID: string
}

async function getTasks(host: string, apiKey: string, teamID: string): Promise<Task[]> {
  // For backwards compatibility, accept a hardcoded list of tasks, if provided.
  const tasksInput = core.getInput("tasks")

  // Translate the old format for buildpacks into the corresponding builders.
  // Note, we don't support newer builders or builder config here. Folks
  // that want to use those will want to remove the `tasks` input. The Action
  // will fetch the config from the Airplane API instead.
  const tasks = JSON.parse(tasksInput) as Array<{
    taskID: string
    buildPack:
      | {
          environment: "go";
          entrypoint: string;
        }
      | {
          environment: "deno";
          entrypoint: string;
        }
      | {
          environment: "docker";
          dockerfile: string;
        };
  }>

  if (tasks.length > 0) {
    return tasks.map((t): Task => {
      if (t.buildPack.environment === "go") {
        return {
          taskID: t.taskID,
          builder: t.buildPack.environment,
          builderConfig: {
            entrypoint: t.buildPack.entrypoint,
          },
        }
      } else if (t.buildPack.environment === "deno") {
        return {
          taskID: t.taskID,
          builder: t.buildPack.environment,
          builderConfig: {
            entrypoint: t.buildPack.entrypoint,
          },
        }
      } else if (t.buildPack.environment === "docker") {
        return {
          taskID: t.taskID,
          builder: t.buildPack.environment,
          builderConfig: {
            dockerfile: t.buildPack.dockerfile,
          },
        }
      } else {
        throw new Error("Unknown environment for taskID=" + t.taskID)
      }
    })
  }

  // Otherwise, fetch the task list from the API.
  const resp = await got
    .get(`https://${host}/api/tasks`, {
      headers: {
        "X-Token": apiKey,
        "X-Team-ID": teamID,
      },
      searchParams: {
        repo: `github.com/${github.context.repo.owner}/${github.context.repo.repo}`
      }
    }).json<{
      tasks: Task[]
    }>();
  
  return resp.tasks
}

async function buildTask(
  b: Builder,
  imageTags: string[],
  buildArgs: string[]
): Promise<void> {
  core.debug(`${JSON.stringify({b, imageTags}, null, 2)}`)

  // Generate a Dockerfile based on the build-pack:
  const dir = await tmpDir(hash(b))
  const dockerfilePath = path.join(dir, "Dockerfile");
  const dockerfile = await getDockerfile(b);
  await fs.writeFile(dockerfilePath, dockerfile);
  core.debug(`wrote Dockerfile to ${dockerfilePath} with contents: \n${dockerfile}`);

  const cacheDir = `/tmp/.buildx-cache/${hash(b)}`
  await fs.mkdir(cacheDir, {
    recursive: true,
  });

  await exec([
    "docker",
    "buildx",
    "build",
    ...imageTags.map((tag) => ["--tag", tag]).flat(1),
    ...buildArgs.map(arg => ["--build-arg", arg]).flat(1),
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
