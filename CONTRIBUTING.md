# Contributing to KubeLearn

New lessons, fixes and corrections are welcome. Anyone can open a pull request; you don't need access to this repository.

Found something technically wrong, but don't want to fix it yourself? [Open an issue](https://github.com/joesabbagh1/kubelearn/issues/new). That's just as helpful. For a new lesson or a large change, open an issue first so we can agree on it before you spend time on it.

## Set up

You need Node 24, the version CI uses.

[Fork the repository](https://github.com/joesabbagh1/kubelearn/fork), then:

```bash
git clone https://github.com/<your-username>/kubelearn.git
cd kubelearn
git switch -c fix/<short-name>   # or feature/, docs/, chore/
npm ci
npm run dev                      # http://localhost:5173
```

The [README](README.md#how-its-put-together) explains how the project is put together.

## Change a lesson

Each lesson is one file in `src/data/lessons/`. To add one:

1. Write the lesson file. The format is in `src/data/types.ts`, and [Writing a lesson](README.md#writing-a-lesson) explains the parts that aren't obvious. An existing lesson is the best starting point.
2. Import it and add it to `LESSONS` in `src/data/lessons/index.ts`.
3. Add its id, in the same position, to the list in `src/data/lessons.test.ts`.

Play the whole lesson in the browser before you open the pull request. The tests check its structure, not whether it's true or easy to follow.

Lessons should match how a real cluster behaves. Back up technical claims with a source, such as the Kubernetes docs, a KEP, the source code or output from your own cluster, and put it in the pull request.

## Check it

CI runs these, and they all have to pass:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## Open a pull request

Open it into `main`, with one change per pull request, and fill in the template. Leave "Allow edits by maintainers" on, so we can bring your branch up to date with `main` if it falls behind.

- If it's your first pull request here, CI waits until the maintainer approves the run.
- The maintainer reviews and merges every pull request. Merging deploys to https://kubelearn.joesabbagh.com.

Contributions are published under the [MIT license](LICENSE).
