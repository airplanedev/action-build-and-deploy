import { promises as fs } from 'fs'

export type Builder =
  | {
      builder: "go";
      builderConfig: {
        entrypoint: string
      }
    }
  | {
      builder: "deno";
      builderConfig: {
        entrypoint: string
      }
    }
  | {
      builder: "docker";
      builderConfig: {
        dockerfile: string
      }
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
      ENTRYPOINT ["deno", "run", "${b.builderConfig.entrypoint}"]
    `;
  } else if (b.builder === "docker") {
    return await fs.readFile(b.builderConfig.dockerfile, {
      encoding: 'utf-8',
    })
  }

  return contents
    .split("\n")
    .map((line) => line.trim())
    .join("\n");
}
