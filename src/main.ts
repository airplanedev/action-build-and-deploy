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
  const apiKey: string = core.getInput("api-key");
  // TODO: remove this dependency on the team id
  const teamID: string = core.getInput("team-id");
  const host: string = core.getInput("host");
  const parallel = core.getInput("parallel") === "true";
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
        ...tags.map((tag) => `${resp.repo}/${toImageName(task.id)}:${tag}`),
      ],
    }
  }

  // Build and publish each image:
  console.log(`Uploading ${tasks.length} task(s) to Airplane...`);
  if (parallel) {
    await Promise.all(
      Object.values(builds).map(build => buildTask(build.b, build.imageTags))
    );
  } else {
    for (const build of Object.values(builds)) {
      await buildTask(build.b, build.imageTags)
    }
  }

  console.log('Done. Ready to launch from https://app.airplane.dev 🛫');
  console.log(`Published tasks: ${tasks.map(task => `\n  - https://app.airplane.dev/tasks/${task.id}`).join("\n")}`)
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

type Task = Builder & {
  id: string
}

async function getTasks(host: string, apiKey: string, teamID: string): Promise<Task[]> {
  // For backwards compatibility, accept a hardcoded list of tasks, if provided.
  const tasksInput = core.getInput("tasks")
  if (!tasksInput) {
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

    return tasks.map((t): Task => {
        if (t.buildPack.environment === "go") {
          return {
            id: t.taskID,
            builder: t.buildPack.environment,
            builderConfig: {
              entrypoint: t.buildPack.entrypoint,
            },
          }
        } else if (t.buildPack.environment === "deno") {
          return {
            id: t.taskID,
            builder: t.buildPack.environment,
            builderConfig: {
              entrypoint: t.buildPack.entrypoint,
            },
          }
        } else if (t.buildPack.environment === "docker") {
          return {
            id: t.taskID,
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
  const req = await got
    .get(`https://${host}/api/tasks`, {
      headers: {
        "X-Token": apiKey,
        "X-Team-ID": teamID,
      },
      searchParams: {
        repo: `github.com/${github.context.repo.owner}/${github.context.repo.repo}`
      }
    })
  console.log(req.url)
  console.log(req.body)
  // const resp = await req.json<{
  //     tasks: Task[]
  //   }>();
  return []
  // return resp.tasks
}

async function buildTask(
  b: Builder,
  imageTags: string[]
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
