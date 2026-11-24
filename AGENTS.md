# Instructions for agents

See [README.md](README.md) for how the project is put together and how to write a lesson.

## Workflow

`main` is protected and deploys to production. Never commit to it or push to it directly.

For every new feature, and any other change:

1. **Branch.** Start from the latest `main`, before editing anything:

   ```bash
   git fetch origin
   git switch -c feature/<short-name> origin/main
   ```

   Use `fix/`, `docs/` or `chore/` in place of `feature/` when it fits better. One feature per branch. If the working tree already has changes that aren't yours, leave them alone and work in a separate `git worktree`.

2. **Build it** on that branch, and commit only the files that belong to the feature.

3. **Check it.** These must pass; CI runs the same ones:

   ```bash
   npm run lint
   npm run typecheck
   npm test
   npm run build
   ```

4. **Open a pull request into `main`** when the feature is done:

   ```bash
   git push -u origin HEAD
   gh pr create --base main
   ```

   Say what changed and how it was checked. If CI fails, fix it on the same branch.

5. **Stop there.** The owner reviews and merges, unless they ask you to merge.

## Deploying

Merging into `main` runs `.github/workflows/ci.yml`, which checks the code again and deploys it to Cloudflare with Wrangler. Don't run `npm run deploy` or `wrangler deploy` by hand unless the owner asks.

Never commit Cloudflare credentials. They live in the GitHub `production` environment.
