# Airplane GitHub Action

GitHub Action for building and uploading code to airplane.dev.

## Usage

To publish your tasks to Airplane, add a `.github/workflows/airplane.yml` file to your repo with the following contents:

```yaml
name: airplane
on: push
jobs:
  run:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v1.1.1
      - name: Cache Docker layers
        uses: actions/cache@v2
        with:
          path: /tmp/.buildx-cache
          key: ${{ runner.os }}-buildx-${{ github.sha }}
          restore-keys: |
            ${{ runner.os }}-buildx-
      - name: Upload Airplane Tasks
        uses: ./
        with:
          # TODO(you): get an API key the Airplane team, then store it as a GitHub Secret:
          # https://docs.github.com/en/actions/reference/encrypted-secrets#creating-encrypted-secrets-for-a-repository
          api-key: ${{ secrets.AIRPLANE_API_KEY }}
          # TODO(you): configure your Airplane tasks. The examples below show each
          # of the supported environments. Reach out to the team if there's an
          # environment you'd like supported.
          #
          # You can get a Task ID from the URL bar, for example:
          #   https://app.airplane.dev/tasks/1234567890
          tasks: |
            [
              {
                "taskID: "1234567890",
                "buildPack": {
                  "environment": "go",
                  "entrypoint": "./cmd/scripts/createWeather/main.go"
                }
              },
              {
                "taskID: "1234567890",
                "buildPack": {
                  "environment": "deno",
                  "entrypoint": "./src/createWeather.ts"
                }
              },
              {
                "taskID: "1234567890",
                "buildPack": {
                  "environment": "docker",
                  "dockerfile": "./Dockerfile"
                }
              }
            ]
```

On every commit, your Airplane tasks will be uploaded. You'll be able to reference uploaded code using the shortened commit SHA or branch name. You can also see these tags in your workflow logs.

> ⚠️ Your branch name may be adjusted to make it a valid Docker tag name.

## Development

```sh
$ yarn install
# GitHub Actions are run directly from a repo. Therefore, you need to compile and
# package all dependencies in the repo itself. Therefore, leave this running:
$ yarn build --watch
```

## Related Resources

- [actions/typescript-action](https://github.com/actions/typescript-action)
- [Debug Logging](https://github.com/actions/toolkit/blob/main/docs/action-debugging.md#step-debug-logs)
- [actions/toolkit/core docs](https://github.com/actions/toolkit/tree/main/packages/core)
- [private access to actions](https://github.com/marketplace/actions/private-actions-checkout)
- [docker/build-push-action](https://github.com/docker/build-push-action)
- [sdras/awesome-actions](https://github.com/sdras/awesome-actions)
