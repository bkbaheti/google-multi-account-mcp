# Deployment

Two things ship from this repo, by two unrelated mechanisms. Neither is obvious from the files, which is why this page exists.

## The website

**Live at: https://multiaccountgooglemcp.procedure.tech/**

Hosted on **Cloudflare**, deploying **automatically from `master`**. Push to `master` and the site updates within about a minute — no tag, no manual step, no approval.

**The connection is configured in the Cloudflare dashboard, not in this repo.** There is no `wrangler.toml`, no deploy workflow, no `CNAME` file, and nothing under `.github/workflows` that touches `site/`. If you go looking for the deploy config in the repo you will not find it — that is expected, not a bug.

To verify a deploy landed:

```bash
curl -s https://multiaccountgooglemcp.procedure.tech/ | grep softwareVersion
```

### Do not be misled by these

Three artefacts point at deployment paths that are **not** in use. All three cost real time to rule out.

| Artefact | Reality |
|---|---|
| Branch `origin/cloudflare/workers-autoconfig` | Contains a `wrangler.jsonc` with `"assets": { "directory": "site" }`. This is the branch Cloudflare auto-creates when you connect a repo to **Workers Builds**. It was never merged and is not what serves the site. |
| Commit `4b84635` "add static site for Cloudflare **Pages**" | Message says Pages. |
| Commit `b370d37` "Add Cloudflare **Workers** configuration" | Adds a Workers config. Pages and Workers are different products; the two commits disagree, and neither describes what is actually running. |

`.github/workflows/publish.yml` is **npm only**. It has never deployed the site — check the Actions history and every run is "Publish to npm".

### The domain, and a trap that already caught us

The site is served from `multiaccountgooglemcp.procedure.tech`.

**`mcp-google.procedure.tech` does not exist** — it returns NXDOMAIN. Until 2026-08-13 the site's own `rel=canonical`, `og:url`, JSON-LD `url`, `sitemap.xml` (all four entries), `robots.txt` sitemap pointer and `llms.txt` website link all pointed at that non-existent domain. A canonical tag aimed at a dead URL tells search engines the live page is a duplicate of something that does not resolve, which can suppress indexing of the page that does.

Fixed in `2771b82`. If you ever add a URL to `site/`, use the live domain. If someone later creates `mcp-google.procedure.tech` as a nicer name, add it as a redirect and update these files deliberately — do not leave two domains disagreeing about which is canonical.

## The npm package

**`@procedure-tech/mcp-google`** — published by `.github/workflows/publish.yml`, triggered by pushing a tag matching `v*`.

```bash
# version must already be bumped and committed
git tag -a v0.5.2 -m "..."
git push origin v0.5.2
```

CI then runs: `pnpm install --frozen-lockfile` → `pnpm build` → `pnpm test` → `npx npm@latest publish --provenance --access public`.

Notes that matter:

- **It publishes to `latest`.** There is no `--tag beta`, despite the package describing itself as beta. A tagged release becomes the default install for everyone on their next `npx` run.
- **Order matters: bump the version, commit, *then* tag.** `pnpm build` regenerates `dist/build-info.json` from `package.json` plus the git SHA. Building before the bump is this project's documented cause of `google_version` reporting a stale version — see CLAUDE.md.
- **No lint step.** `pnpm biome check` currently reports pre-existing errors; they will not block a release. Do not read a green publish as a clean lint.
- `dist/` is not committed. CI builds it from the tagged commit.

### dist-tags cannot be automated here — `beta` was therefore retired

**Current state: `latest` is the only dist-tag.** `beta` was removed on 2026-08-18
(`npm dist-tag rm @procedure-tech/mcp-google beta`). The reasoning below is kept because it is
why the tag is gone and why it must not come back.

`beta` drifted to a four-month-old version (0.3.1) because nothing kept it current, and the obvious
fix — add an `npm dist-tag add` step to `publish.yml` — **does not work**. npm's trusted-publishing
docs are explicit: *"OIDC authentication supports the `npm publish` and `npm stage publish` commands.
Other npm commands such as `install`, `view`, or `access` still require traditional authentication
methods."*

So a dist-tag step in CI would fail unless a long-lived npm token were stored as a repo secret —
reintroducing exactly the dependency this project removed when it adopted OIDC (see the npm Trusted
Publisher item in `docs/TASKS.md`). Do not trade a token-free pipeline for a dist-tag.

Consequences, so nobody rediscovers this:

- `npm publish` sets exactly one tag. Without `--tag` it sets `latest`, which is what this workflow does.
- Any *additional* tag must be set by a human, from an authenticated CLI, with a 2FA one-time password
  (`npm dist-tag add <pkg>@<version> beta --otp=<code>`). It cannot be scripted here.
- Therefore: **there is a single channel.** Every release goes to `latest`. "Beta" is a maturity
  statement in the README, the site and the package description — it does not need a dist-tag, and a
  second tag that nobody can automate will drift again.
- **Do not re-add `beta`, or any other second tag.** Doing so reintroduces a per-release manual step
  that requires a human with a 2FA one-time password, which is exactly the failure this removal
  fixed. If a pre-release channel is ever genuinely needed, publish a prerelease *version*
  (`0.7.0-rc.1`) — npm keeps prerelease versions out of `latest` automatically, with no second tag
  to maintain.

To verify what actually shipped, rather than trusting the green check:

```bash
npm view @procedure-tech/mcp-google version dist-tags
npm pack @procedure-tech/mcp-google@<version>   # then inspect package/dist/build-info.json
```

The `commit` field in `build-info.json` should match the tagged commit.

## Release checklist

`CLAUDE.md` carries this too, so an agent running a release is prompted by it. Repeated here because
this is the canonical page.

1. Bump `package.json`, commit. **Do not run `pnpm build`** — CI builds from the tagged commit.
2. `git tag -a vX.Y.Z -m "..."` then `git push origin vX.Y.Z`.
3. Wait for the workflow, then verify: `npm view @procedure-tech/mcp-google version dist-tags`.
4. Confirm the artifact: `npm pack @procedure-tech/mcp-google@X.Y.Z`, check that
   `package/dist/build-info.json`'s `commit` matches the tagged commit.
5. If `site/` changed, bump `site/index.html` (`softwareVersion` in the JSON-LD, and the
   release-notes block) and push, then confirm the Cloudflare deploy landed:
   `curl -s https://multiaccountgooglemcp.procedure.tech/ | grep softwareVersion`

   Do this **after** the npm tag is out, never before. The site auto-deploys from `master`, so an
   early bump advertises a version nobody can install yet.

There is no dist-tag step. `latest` is the only tag and `npm publish` sets it; see above for why a
second one is not worth having.
