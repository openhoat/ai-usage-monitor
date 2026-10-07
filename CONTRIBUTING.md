# Contributing

Thanks for considering contributing to `ai-usage-monitor`.

## Workflow

`main` is the production branch: every commit on it is deployable and is tagged
on release. Work happens on feature branches, then lands on `main` through a
pull request with a **rebase merge**.

### Branch naming

- `feat/...` — new feature or evolution
- `fix/...` — bug fix
- `refactor/...` — refactoring
- `docs/...` — documentation
- `chore/...` — maintenance / configuration

### Flow

1. Branch off `main` (keep it up to date with the latest `main`).
2. Make your changes. Commits must follow
   [Conventional Commits](https://www.conventionalcommits.org/) in English (see
   below).
3. Rebase your branch on `main` before opening the PR, and keep it linear.
4. Open a pull request against `main`. Refer to a related issue with `Closes #N`
   when applicable.
5. Ensure the `Validate` check passes (`npm run validate`).
6. Merge with **rebase** (merge commits are disabled on the repository).

## Commit messages

- English, Conventional Commits format: `<type>(<scope>): <subject>`
- Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`,
  `revert`
- Lower-case subject, imperative mood, no trailing period (enforced by
  commitlint)

Example:

```text
feat: add configurable refresh interval
```

## Local validation

Always run the full gate before pushing:

```bash
npm run validate
```

This runs the linter (biome + markdownlint + prettier), the architecture check
(dependency-cruiser), the type checker, and the unit tests with coverage. The
gate also builds the server and the web app.

The end-to-end tests (Playwright) are run separately against a built server:

```bash
npm run build
npm run test:e2e
```

Husky wires this up for you: `pre-commit` runs `npm run validate`, `pre-push`
runs `npm test`, and `commit-msg` runs commitlint.

## Static analysis (SonarQube)

Coverage and static analysis are pushed to the self-hosted SonarQube with:

```bash
export SONAR_HOST_URL=https://sonar.op3n.cloud
export SONAR_TOKEN=...   # a token with analysis rights
npm run sonar
```

The strict TypeScript quality profile and quality gate are provisioned once with
`scripts/sonar-strict-profile.sh` (idempotent).

## Releases

Releases are cut from `main`:

```bash
npm run bump minor        # bump package.json
npm run changelog         # regenerate CHANGELOG.md from the commit history
git commit -am "chore(release): <version>"
git tag v<version>
git push --follow-tags
```

The version tag triggers the release and Docker image workflows.
