import * as core from "@actions/core";
import { existsSync, promises as fs } from "fs";
import * as path from "path";

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
      builder: "docker";
      builderConfig: {
        dockerfile: string;
      };
    };

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
    const entrypoint = b.builderConfig.entrypoint;
    const entryDir = path.dirname(entrypoint);
    const pathParts = entryDir.split(path.sep);
    // Find the closest directory to entrypoint as working directory
    let workingDir = null;
    while (pathParts.length >= 0) {
      if (existsSync(path.join(...pathParts, "package.json"))) {
        workingDir = path.join(...pathParts);
        break;
      }
      pathParts.pop();
    }
    if (workingDir === null) {
      throw new Error(
        `Could not find package.json in any directories above ${b.builderConfig.entrypoint}`
      );
    }
    let installCommand;
    const installFiles = [path.join(workingDir, "package.json")];
    if (existsSync(path.join(workingDir, "package-lock.json"))) {
      installCommand = "npm install";
      installFiles.push(path.join(workingDir, "package-lock.json"));
      core.info(`Detected package-lock.json, running: ${installCommand}`);
    } else {
      installCommand = "yarn";
      if (existsSync(path.join(workingDir, "yarn.lock"))) {
        installFiles.push(path.join(workingDir, "yarn.lock"));
      }
      core.info(`Using default install command: ${installCommand}`);
    }
    const buildDir = ".airplane-build";
    const relativeEntrypointJS = path
      .relative(workingDir, b.builderConfig.entrypoint)
      .replace(/\.ts$/, ".js");
    contents = `
      FROM node:15.8-stretch

      RUN npm install -g typescript@4.1
      WORKDIR /airplane
      
      COPY ${installFiles.join(" ")} ./
      RUN ${installCommand}
      
      COPY ${workingDir} ./
      RUN echo "Cleaning ${buildDir} in case it exists" \
          && rm -rf ${buildDir}/ \
          && echo "Running tsc" \
          && tsc --outDir ${buildDir}/
      
      ENTRYPOINT ["node", "${buildDir}/${relativeEntrypointJS}"]
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
