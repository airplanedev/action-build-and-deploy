import * as core from "@actions/core";
import { existsSync, promises as fs } from "fs";
import { join, dirname, sep, relative } from "path";

export type Builder =
  | {
      builder: "go";
      builderConfig: {
        entrypoint: string;
      };
    }
  | {
      builder: "deno";
      builderConfig: {
        entrypoint: string;
      };
    }
  | {
      builder: "node-typescript";
      builderConfig: {
        entrypoint: string;
      };
    }
  | {
      builder: "python";
      builderConfig: {
        entrypoint: string;
      };
    }
  | {
      builder: "docker";
      builderConfig: {
        dockerfile: string;
      };
    };

const NODE_VERSION = "15.8";
const TYPESCRIPT_VERSION = 4.1;

export async function getDockerfile(b: Builder): Promise<string> {
  let contents = "";
  if (b.builder === "go") {
    contents = `
      FROM golang:1.15.7-alpine3.13 as builder

      WORKDIR /airplane

      COPY go.* ./
      RUN go mod download

      ADD . .

      RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -tags netgo -ldflags '-w' -o main ${b.builderConfig.entrypoint}

      FROM gcr.io/distroless/static

      COPY --from=builder /airplane/main /bin/main

      ENTRYPOINT ["/bin/main"]
    `;
  } else if (b.builder === "deno") {
    contents = `
      FROM hayd/alpine-deno:1.7.1

      WORKDIR /airplane

      ADD . .
      RUN deno cache ${b.builderConfig.entrypoint}

      USER deno
      ENTRYPOINT ["deno", "run", "-A", "${b.builderConfig.entrypoint}"]
    `;
  } else if (b.builder === "node-typescript") {
    // Builder runs node Docker image, installs using npm (if package-lock.json) else yarn, then compiles using tsc
    const { entrypoint } = b.builderConfig;
    // Find the closest directory to entrypoint as working directory
    let workingDir = null;
    const pathParts = dirname(entrypoint).split(sep);
    while (pathParts.length >= 0) {
      if (existsSync(join(...pathParts, "package.json"))) {
        workingDir = join(...pathParts);
        break;
      }
      pathParts.pop();
    }
    if (workingDir === null) {
      throw new Error(
        `Could not find package.json in any directories above ${b.builderConfig.entrypoint}`
      );
    }
    // Determine installCommand and installFiles
    let installCommand;
    const installFiles = [join(workingDir, "package.json")];
    if (existsSync(join(workingDir, "package-lock.json"))) {
      installCommand = "npm install";
      installFiles.push(join(workingDir, "package-lock.json"));
      core.info(`Detected package-lock.json, running: ${installCommand}`);
    } else {
      installCommand = "yarn";
      if (existsSync(join(workingDir, "yarn.lock"))) {
        installFiles.push(join(workingDir, "yarn.lock"));
      }
      core.info(`Using default install command: ${installCommand}`);
    }
    // Produce a Dockerfile
    const buildDir = ".airplane-build";
    const relativeEntrypointJS = relative(
      workingDir,
      b.builderConfig.entrypoint
    ).replace(/\.ts$/, ".js");
    contents = `
      FROM node:${NODE_VERSION}-stretch

      RUN npm install -g typescript@${TYPESCRIPT_VERSION}
      WORKDIR /airplane
      
      COPY ${installFiles.join(" ")} ./
      RUN ${installCommand}
      
      COPY ${workingDir} ./
      RUN echo "Cleaning ${buildDir} in case it exists" \
          && rm -rf ${buildDir}/ \
          && echo "Running tsc" \
          && tsc --outDir ${buildDir}/ --rootDir .
      
      ENTRYPOINT ["node", "${buildDir}/${relativeEntrypointJS}"]
    `;
  } else if (b.builder === "python") {
    const requirementsPath = await find(
      "requirements.txt",
      dirname(b.builderConfig.entrypoint)
    );
    if (!requirementsPath) {
      throw new Error("Unable to find a requirements.txt");
    }

    contents = `
      FROM python:3.9-buster

      WORKDIR /airplane

      ADD ${requirementsPath} ${requirementsPath}
      RUN pip install -r ${requirementsPath}

      ADD . .

      ENTRYPOINT ["python", "${b.builderConfig.entrypoint}"]
    `;
  } else if (b.builder === "docker") {
    return await fs.readFile(b.builderConfig.dockerfile, {
      encoding: "utf-8",
    });
  }

  return contents
    .split("\n")
    .map((line) => line.trim())
    .join("\n");
}

async function find(file: string, dir: string): Promise<string | undefined> {
  const path = join(dir, file);
  try {
    await fs.stat(path);
    return path;
  } catch (_) {
    // file doesn't exist, continue...
  }

  // The file doesn't exist, since we couldn't find it
  // in any directory up to the root.
  if (dir === "." || dir === "/") {
    return undefined;
  }

  return find(file, dirname(dir));
}
