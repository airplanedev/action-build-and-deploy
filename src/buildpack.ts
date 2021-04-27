import * as core from "@actions/core";
import { existsSync, promises as fs } from "fs";
import { join, dirname, relative } from "path";

export type Builder =
  | {
      kind: "go";
      kindOptions: {
        entrypoint: string;
      };
    }
  | {
      kind: "deno";
      kindOptions: {
        entrypoint: string;
      };
    }
  | {
      kind: "node";
      kindOptions: {
        nodeVersion: string;
        language: "typescript" | "javascript";
        entrypoint: string;
        buildCommand: string;
      };
    }
  | {
      kind: "python";
      kindOptions: {
        entrypoint: string;
      };
    }
  | {
      kind: "docker";
      kindOptions: {
        dockerfile: string;
      };
    };

const NODE_VERSIONS: Record<string, string> = {
  "15": "15.8",
  "14": "14.16",
  "12": "12.21",
};
const NODE_DEFAULT_VERSION = "15";
const TYPESCRIPT_VERSION = "4.1";

export async function getDockerfile(b: Builder): Promise<string> {
  let contents = "";
  if (b.kind === "go") {
    const goModPath = await find("go.mod", dirname(b.kindOptions.entrypoint));
    if (!goModPath) {
      throw new Error("Unable to find go.mod");
    }
    const projectRoot = dirname(goModPath);
    const goSumPath = join(projectRoot, "go.sum");
    const entrypoint = relative(projectRoot, b.kindOptions.entrypoint);

    contents = `
      FROM golang:1.16.0-alpine3.13 as builder

      WORKDIR /airplane

      COPY ${goModPath} ${goSumPath} .
      RUN go mod download

      COPY ${projectRoot} .

      ENTRYPOINT ["go", "run", "${entrypoint}"]
    `;
  } else if (b.kind === "deno") {
    contents = `
      FROM hayd/alpine-deno:1.7.2

      WORKDIR /airplane

      ADD . .
      RUN deno cache ${b.kindOptions.entrypoint}

      USER deno
      ENTRYPOINT ["deno", "run", "-A", "${b.kindOptions.entrypoint}"]
    `;
  } else if (b.kind === "node") {
    // Find package.json to determine project root
    const packageJSONPath = await find(
      "package.json",
      dirname(b.kindOptions.entrypoint)
    );
    if (!packageJSONPath) {
      throw new Error("Unable to find package.json");
    }
    const projectRoot = dirname(packageJSONPath);

    // Determine installCommand and installFiles
    let installCommand;
    const installFiles = [join(projectRoot, "package.json")];
    if (existsSync(join(projectRoot, "package-lock.json"))) {
      installCommand = "npm install";
      installFiles.push(join(projectRoot, "package-lock.json"));
      core.info(`Detected package-lock.json, running: ${installCommand}`);
    } else {
      installCommand = "yarn";
      if (existsSync(join(projectRoot, "yarn.lock"))) {
        installFiles.push(join(projectRoot, "yarn.lock"));
      }
      core.info(`Using default install command: ${installCommand}`);
    }

    // Detect NPM_RC or NPM_AUTH in env vars
    const npmrcFile = join(projectRoot, ".npmrc");
    if (process.env.NPM_RC) {
      core.info("Found NPM_RC environment variable - creating .npmrc");
      await fs.writeFile(npmrcFile, process.env.NPM_RC);
      installFiles.push(npmrcFile);
    } else if (process.env.NPM_TOKEN) {
      core.info("Found NPM_TOKEN environment variable - creating .npmrc");
      await fs.writeFile(
        npmrcFile,
        `//registry.npmjs.org/:_authToken=${process.env.NPM_TOKEN}`
      );
      installFiles.push(npmrcFile);
    }

    // Produce a Dockerfile
    let tsInstall = "";
    let tsConfigure = "";
    let buildCommand = b.kindOptions.buildCommand ?? "";
    let entrypoint: string;

    if (b.kindOptions.language === "typescript") {
      const buildDir = ".airplane-build";
      tsInstall = `RUN npm install -g typescript@${TYPESCRIPT_VERSION}`;
      tsConfigure = `RUN [ -f tsconfig.json ] || echo '{"include": ["*", "**/*"], "exclude": ["node_modules"]}' >tsconfig.json`;
      // Run the typescript build first, followed by buildCommand
      buildCommand = `rm -rf ${buildDir}/ && tsc --outDir ${buildDir}/ --rootDir .${
        buildCommand === "" ? "" : ` && ${buildCommand}`
      }`;
      entrypoint = join(
        buildDir,
        relative(projectRoot, b.kindOptions.entrypoint).replace(
          /\.ts$/,
          ".js"
        )
      );
    } else if (b.kindOptions.language === "javascript") {
      entrypoint = relative(projectRoot, b.kindOptions.entrypoint);
    } else {
      throw new Error(
        `Unexpected node language: ${JSON.stringify(b.kindOptions.language)}`
      );
    }

    const nodeVersion =
      b.kindOptions.nodeVersion == null
        ? // If it's not set, use a default version:
          NODE_VERSIONS[NODE_DEFAULT_VERSION]
        : // Typically we expect to look up the nodeVersion (e.g. "15") to resolve it to the pinned minor version (e.g. "15.8"):
          NODE_VERSIONS[b.kindOptions.nodeVersion] ??
          // If it's not in our list of node versions, this might be an explicit patch version from a previous config.
          // Just fall back to the exact specified version:
          b.kindOptions.nodeVersion;
    contents = `
      FROM node:${nodeVersion}-buster
      
      ${tsInstall}
      WORKDIR /airplane
      
      COPY ${installFiles.join(" ")} ./
      RUN ${installCommand}
      
      COPY ${projectRoot} ./
      ${tsConfigure}
      ${buildCommand === "" ? "" : `RUN ${buildCommand}`}
      
      ENTRYPOINT ["node", "${entrypoint}"]
    `;
  } else if (b.kind === "python") {
    const requirementsPath = await find(
      "requirements.txt",
      dirname(b.kindOptions.entrypoint)
    );
    if (!requirementsPath) {
      throw new Error("Unable to find a requirements.txt");
    }

    contents = `
      FROM python:3.9.1-buster

      WORKDIR /airplane

      COPY ${requirementsPath} ${requirementsPath}
      RUN pip install -r ${requirementsPath}

      COPY . .

      ENTRYPOINT ["python", "${b.kindOptions.entrypoint}"]
    `;
  } else if (b.kind === "docker") {
    return await fs.readFile(b.kindOptions.dockerfile, {
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
