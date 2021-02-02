import { promises as fs } from 'fs'

export type BuildPack =
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

export async function getDockerfile(bp: BuildPack): Promise<string> {
  let contents = "";
  if (bp.environment === "go") {
    contents = `
      FROM golang:1.15.7-alpine3.13 as builder

      WORKDIR /airplane

      COPY go.* ./
      RUN go mod download

      ADD . .

      RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -tags netgo -ldflags '-w' -o main ${bp.entrypoint}

      FROM gcr.io/distroless/static

      COPY --from=builder /airplane/main /bin/main

      ENTRYPOINT ["/bin/main"]
    `;
  } else if (bp.environment === "deno") {
    contents = `
      FROM hayd/alpine-deno:1.7.1

      WORKDIR /airplane

      ADD . .
      RUN deno cache ${bp.entrypoint}

      USER deno
      ENTRYPOINT ["deno", "run", "${bp.entrypoint}"]
    `;
  } else if (bp.environment === "docker") {
    return await fs.readFile(bp.dockerfile, {
      encoding: 'utf-8',
    })
  }

  return contents
    .split("\n")
    .map((line) => line.trim())
    .join("\n");
}
