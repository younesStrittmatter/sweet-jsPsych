# 1) Install deps and build everything
npm i
npm run build

# 2) Bump version of the changed package (pick patch|minor|major)
npm version patch --workspace @sweet-jspsych/plugin-gabor-array

# 3) Sanity check publish payload for that package
npm pack --dry-run --workspace @sweet-jspsych/plugin-gabor-array

# 4) Rebuild to ensure dist carries the new version
npm run build

# 5) Publish all packages that were bumped (lerna from-package)
npm run publish
# (this should be wired to: lerna publish from-package --yes)

# 6) Push tags (npm version created a git tag)
git push --follow-tags

# 7) Verify
npm view @sweet-jspsych/plugin-gabor-array version
