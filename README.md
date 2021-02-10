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
        uses: docker/setup-buildx-action@v1
      - name: Cache Docker layers
        uses: actions/cache@v2
        with:
          path: /tmp/.buildx-cache
          key: ${{ runner.os }}-buildx-${{ github.sha }}
          restore-keys: |
            ${{ runner.os }}-buildx-
      - name: Upload Airplane Tasks
        uses: airplanedev/action-build-and-deploy@v0.1
        with:
          # TODO(you): get an API key the Airplane team, then store it as a GitHub Secret:
          # https://docs.github.com/en/actions/reference/encrypted-secrets#creating-encrypted-secrets-for-a-repository
          api-key: ${{ secrets.AIRPLANE_API_KEY }}
          # TODO(you): reach out to the Airplane team to get your team's ID
          team-id: abcdefghijk
```

On every commit, all Airplane tasks connected to that GitHub repo will be uploaded. You'll be able to reference uploaded code using the shortened commit SHA or branch name. You can also see these tags in your workflow logs.

> ⚠️ Your branch name may be adjusted to make it a valid Docker tag name.

## Configuration

By default, this Action doesn't need any further configuration.

However, if you are building your own Dockerfiles using this Action then you may want to pass through build arguments. For example, to provide credentials for pulling down dependencies. You can do this with the `build-args` input:

```yaml
- name: Upload Airplane Tasks
  # ...
  with:
    # ...
    build-args: |
      SOME_CREDENTIAL=foobar
      ANOTHER_CREDENTIAL=${{ env.ENV_VAR }}
```

## Development

```sh
$ yarn install
# GitHub Actions are run directly from a repo. Therefore, you need to compile and
# package all dependencies in the repo itself. Therefore, leave this running:
$ yarn watch
```

## Deployment

To deploy a new version of this GitHub Action, create [a new release](https://github.com/airplanedev/action-build-and-deploy/releases/new). Releases are tagged using [semver](https://github.com/actions/toolkit/blob/master/docs/action-versioning.md#versioning). In the release, set the tag version and release title to your new version. Make sure to use a `v` prefix, such as `v0.5.4`. Add a description of the changes with links to previous PRs ([examples](https://github.com/airplanedev/action-build-and-deploy/releases)).

After creating the release, update the latest major version to point to this new tag. Consumers of this Action will reference the major version so that they always get the latest minor updates. If you are releasing a new major version, make sure to update the README example above.

```sh
git fetch --tags
# Checkout the tag you just released.
git checkout v0.5.4
# Alias it with the major version.
git tag -f v0.5
# Push to GitHub, --force for when the major tag already exists.
git push origin v0.5 --force
```

## Related Resources

- [actions/typescript-action](https://github.com/actions/typescript-action)
- [Debug Logging](https://github.com/actions/toolkit/blob/main/docs/action-debugging.md#step-debug-logs)
- [actions/toolkit/core docs](https://github.com/actions/toolkit/tree/main/packages/core)
- [private access to actions](https://github.com/marketplace/actions/private-actions-checkout)
- [docker/build-push-action](https://github.com/docker/build-push-action)
- [sdras/awesome-actions](https://github.com/sdras/awesome-actions)
