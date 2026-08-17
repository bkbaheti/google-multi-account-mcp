# Security Policy

## Reporting a vulnerability

Please report security issues privately via [GitHub Security
Advisories](https://github.com/bkbaheti/google-multi-account-mcp/security/advisories/new),
or by email to the maintainer. Please do not open a public issue for an
unfixed vulnerability.

We will confirm receipt, tell you whether we consider the finding valid, and
credit you when a fix ships — unless you would rather stay anonymous.

## Before you report: the embedded OAuth client secret is intentional

`src/auth/oauth-defaults.ts` contains a Google OAuth **client ID and client
secret** in plain text. Automated secret scanners flag this, and we have
already received a responsible-disclosure report about it. It is not a leak,
and **rotating it would accomplish nothing** — please read this section before
filing.

The credential belongs to a Google **"Desktop app"** OAuth client, which is a
*public client* under [RFC 8252 (OAuth 2.0 for Native
Apps)](https://datatracker.ietf.org/doc/html/rfc8252). Google's own
documentation for desktop and mobile apps states that the secret is embedded in
the application and "in this context, the client secret is obviously not
treated as a secret." The same pattern ships in `gcloud`, the GitHub CLI, and
VS Code.

Specifically:

- The secret grants no access on its own. Every token is obtained through an
  interactive Google consent screen and stored only on the user's machine.
- Rotation is not a remediation. This server is distributed as an npm package,
  so any replacement secret would be published in the next release. There is no
  version of this design in which the value is secret.
- Git history rewriting is not a remediation either, for the same reason.

If you have found something that depends on the secret being confidential — a
path where it grants access without user consent, or where it is used as an
authentication factor rather than a client identifier — that **is** a real
finding and we would like to hear about it.

### What actually protects this flow

Because the client is public, the authorization code is protected by controls
that do not depend on the secret:

- **PKCE (RFC 7636), S256.** The `code_verifier` never leaves the server
  process, so an intercepted authorization code cannot be exchanged for tokens
  even by someone holding the published client secret.
- **Ephemeral loopback port (RFC 8252 §7.3).** The callback server binds an
  OS-assigned port rather than a fixed one, so there is no predictable port for
  a local process to claim first.
- **Literal loopback IP (RFC 8252 §8.3).** The redirect URI uses `127.0.0.1`
  rather than `localhost`, whose name resolution a tampered hosts file could
  redirect.
- **`state` parameter**, generated per flow and verified on callback.
- **Tokens at rest** go to the OS keychain where available, falling back to an
  AES-256-GCM encrypted file.

Removing any of the first three would turn the embedded secret from a
non-issue into a real vulnerability. Please do not.

### Known and accepted trade-offs

These follow from shipping a shared public client. They are design costs we
have accepted, not oversights — reports about them are welcome but will likely
be closed as "won't fix":

- Anyone can build an application using this client ID, and its users will see
  this project's verified consent screen and app name. PKCE does not prevent
  this.
- Third-party use of the client ID consumes this project's Google API quota.

Users who want none of this can supply their own OAuth credentials, which take
precedence over the shipped defaults:

```sh
export GOOGLE_CLIENT_ID=...
export GOOGLE_CLIENT_SECRET=...
```

or set the `oauth` field in `~/.config/mcp-google/config.json`. Resolution
order is env vars → config file → shipped defaults.

## Scope

This project is a local-first MCP server that runs on the user's own machine
with credentials the user has authorized. In scope: authentication and token
handling, the capability/scope gate, the confirm gate on destructive and
outbound operations, and path handling for local file reads and writes. Out of
scope: anything requiring an attacker to already control the user's account or
to have root on their machine.
