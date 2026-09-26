# Security Policy

## Supported Versions

Security fixes go into the latest minor release only. Flow Weaver is in beta, so upgrade to the latest version before reporting.

## Reporting a Vulnerability

If you discover a security vulnerability, report it privately through GitHub's [private vulnerability reporting](https://github.com/synergenius-fw/flow-weaver/security/advisories/new) or by email to **support@synergenius.pt**. Do not open a public issue.

We will acknowledge receipt within 48 hours and aim to provide a fix or mitigation within 7 days for critical issues.

## What Is Exposed

Flow Weaver runs your workflows, which run your code, so each surface that can start a run is guarded:

- **`fw console`** listens on `127.0.0.1` and has no login. It answers only to a loopback host name, which defeats DNS rebinding, and refuses a change sent from any other origin. Binding it elsewhere needs `--insecure`. See [Console](docs/reference/console.md).
- **`fw serve`** listens on `127.0.0.1` unless told otherwise. Any other host needs `--token` (every route but `/health` then requires `Authorization: Bearer`) or `--insecure`. A callback URL a caller names must resolve to a public address, checked again at each delivery, unless the server's policy allows more. See [Deployment](docs/reference/deployment.md).
- **The MCP server** speaks over stdio to the assistant that started it, with that assistant's access to your files.
- **Runs** are kept under the project's `.fw/runs`. A run id must be a single path segment.

A report that one of these guards can be bypassed is a vulnerability; please report it as above.
