# Instructions for agents

See [README.md](README.md) for how the project is put together and how to write a lesson.

## Workflow

`main` is protected and deploys to production. Never commit to it or push to it directly.

For every new feature, and any other change:

1. **Make a worktree and a branch.** Several agents work on this project at the same time, so every feature gets its own git worktree with its own branch. Do this first, before editing anything, even for a one-line change and even when the main checkout is clean. From the main checkout:

   ```bash
   git fetch origin
   git worktree add --no-track -b feature/<short-name> ../kubelearn-worktrees/<short-name> origin/main
   cd ../kubelearn-worktrees/<short-name>
   npm ci
   ```

   Use `fix/`, `docs/` or `chore/` in place of `feature/` when it fits better. One feature per branch, one branch per worktree.

   - Do everything there: edits, commits, checks and the dev server. Never edit, commit, stash or switch branches in the main checkout or in another agent's worktree, even if the changes in it look left over.
   - If `git worktree list` shows you are already in a worktree made for this feature, stay in it.
   - If your tool can move the session into a worktree, let it, starting from `origin/main`: `t3_worktree_handoff` in T3 Code, or `EnterWorktree` with the `path` of the worktree you made in Claude Code.
   - Keep worktrees outside the repository. Vitest run from the main checkout would pick up the tests of any worktree inside it.
   - `npm run dev` moves to the next free port when 5173 is taken. Open the address it prints; 5173 may be another agent's.

2. **Build it** on that branch, and commit only the files that belong to the feature.

3. **Check it.** These must pass; CI runs the same ones:

   ```bash
   npm run lint
   npm run typecheck
   npm test
   npm run build
   ```

4. **Open a pull request into `main`** when the feature is done. Another feature may have merged since you started, so bring it in first and run the checks again if it did:

   ```bash
   git fetch origin
   git merge origin/main
   git push -u origin HEAD
   gh pr create --base main
   ```

   New lessons all change the same few places (the lesson list, its tests and the lesson counts), so expect conflicts there: keep both lessons and correct the counts.

   Say what changed and how it was checked. If CI fails, fix it on the same branch.

5. **Stop there.** The owner reviews and merges, unless they ask you to merge. Once it is merged, remove your own worktree and branch, and nobody else's:

   ```bash
   git worktree remove ../kubelearn-worktrees/<short-name>
   git branch -d <branch>
   ```

## Deploying

Merging into `main` runs `.github/workflows/ci.yml`, which checks the code again and deploys it to Cloudflare with Wrangler. Don't run `npm run deploy` or `wrangler deploy` by hand unless the owner asks.

Never commit Cloudflare credentials. They live in the GitHub `production` environment.
