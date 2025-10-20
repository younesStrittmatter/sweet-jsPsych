# 1) Install deps and build everything

```shell
npm i
npm run build
```

# 2) Bump version of the changed package (pick patch|minor|major)

```shell
npm version patch --workspace @sweet-jspsych/plugin-symbol
```

# 3) Sanity check publish payload for that package (optional)

```shell
npm pack --dry-run --workspace @sweet-jspsych/plugin-symbol
```

# 4) Rebuild to ensure dist carries the new version

```shell
npm run build
```

# 5) Publish all packages that were bumped (lerna from-package)

```shell
npm run publish
```

# (this should be wired to: lerna publish from-package --yes)

# 6) Push tags (npm version created a git tag) (optional if you want to keep tags)

```shell
git push --follow-tags
```

# 7) Verify (optional)

```shell
npm view @sweet-jspsych/plugin-gabor-array version
```