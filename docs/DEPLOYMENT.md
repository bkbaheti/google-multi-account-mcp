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

CI then runs: `pnpm install --frozen-lockfile` → `pnpm build` → `pnpm test` → `npm publish --provenance --access public`.

Notes that matter:

- **It publishes to `latest`.** There is no `--tag beta`, despite the package describing itself as beta. A tagged release becomes the default install for everyone on their next `npx` run.
- **Order matters: bump the version, commit, *then* tag.** `pnpm build` regenerates `dist/build-info.json` from `package.json` plus the git SHA. Building before the bump is this project's documented cause of `google_version` reporting a stale version — see CLAUDE.md.
- **No lint step.** `pnpm biome check` currently reports pre-existing errors; they will not block a release. Do not read a green publish as a clean lint.
- `dist/` is not committed. CI builds it from the tagged commit.

To verify what actually shipped, rather than trusting the green check:

```bash
npm view @procedure-tech/mcp-google version dist-tags
npm pack @procedure-tech/mcp-google@<version>   # then inspect package/dist/build-info.json
```

The `commit` field in `build-info.json` should match the tagged commit.
