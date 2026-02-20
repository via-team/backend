# CI/CD

This document describes the continuous integration and deployment setup for the VIA backend.

## GitHub Actions CI

The [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) workflow runs on every push and pull request to `main` and `build/setup-ci`.

**Steps:**
1. **Lint** — `npm run lint` (ESLint)
2. **Test** — `npm test` (Jest + Supertest)
3. **Verify** — Start server and hit `/health` to confirm it runs

## Local commands

| Command | Description |
|---------|-------------|
| `npm run lint` | Run ESLint on `src/` |
| `npm test` | Run Jest tests in `test/` |

## Branch protection

To require CI to pass before merging into `main`, configure branch protection in GitHub:

1. Go to **Settings** → **Branches** → **Add branch protection rule**
2. Set **Branch name pattern** to `main`
3. Enable **Require status checks to pass before merging**
4. Search for and select **verify** (the CI job name)
5. Optionally enable **Require branches to be up to date before merging**
6. Save

After this, pull requests targeting `main` must have a passing CI run before they can be merged.

### Using GitHub CLI

If you have [GitHub CLI](https://cli.github.com/) installed:

```bash
gh api repos/:owner/:repo/branches/main/protection \
  -X PUT \
  -H "Accept: application/vnd.github+json" \
  -f required_status_checks='{"strict":true,"contexts":["verify"]}' \
  -F enforce_admins=false \
  -F required_pull_request_reviews='null' \
  -F restrictions='null'
```

Replace `:owner` and `:repo` with your repository's owner and name.

## Deployment (Render)

The backend is deployed on [Render](https://render.com). When the repo is connected:

- **Auto-deploy:** Pushes to `main` trigger a new deployment
- **Build:** `npm install`
- **Start:** `npm start`

Render deploys independently of GitHub Actions. To deploy only after CI passes, either:

1. Use **branch protection** (above) so only CI-passing code reaches `main`, or
2. Disable auto-deploy and use a [deploy hook](https://render.com/docs/deploy-hooks) triggered from the CI workflow
