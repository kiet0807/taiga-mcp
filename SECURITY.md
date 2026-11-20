# Security

## Reporting a vulnerability

Please report it privately, not in a public issue: open the repository's **Security** tab and choose **Report a vulnerability** ([direct link](https://github.com/kiet0807/taiga-mcp/security/advisories/new)). Only the maintainer sees the report.

Say what you did, what happened and what you expected, and which version you used (the npm version, or the address of the hosted server). A short script or a list of requests helps most.

This project has one maintainer. Expect an answer within a week. A confirmed problem is fixed in a new release, and you are credited in the advisory unless you would rather not be.

## Supported versions

Fixes go into the latest release on npm (`@kietdev/taiga-mcp`) and the hosted server at `https://taiga.kaidev.io.vn`. Older versions are not patched: update to the latest one.

## What counts

Welcome reports, for example:

- reading or changing Taiga data that the signed-in account should not reach, or another person's data;
- getting past the sign-in, PKCE, or the box that allows writing;
- reading, forging or reusing the tokens the server hands out;
- making a server started with `ANY_TAIGA` connect to a private, loopback or link-local address;
- a Taiga password or token ending up in logs, error messages or tool answers.

Not a vulnerability here:

- bugs in Taiga itself: report those to Taiga;
- the limits the README already states under [How signing in works](README.md#how-signing-in-works): a connection cannot be revoked before its tokens run out, and an authorization code is kept single-use only within one running process;
- text written in Taiga items reaching the AI model. The server tells the model to treat it as data, not as instructions, but cannot guarantee what a model does. A way in which the server itself makes this worse is welcome;
- flooding the hosted server with traffic.

## Testing

Real people use `https://taiga.kaidev.io.vn`. Test against your own copy (`pnpm dev:http`, see the README) or, on the hosted server, only with your own Taiga account and at a gentle pace. Never use someone else's account or data.
