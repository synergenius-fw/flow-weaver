# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability, please report it privately via email to **support@synergenius.pt**. Do not open a public issue.

We will acknowledge receipt within 48 hours and aim to provide a fix or mitigation within 7 days for critical issues.

## Known Issues

### CVE-2026-26996 — minimatch ReDoS (CVSS 8.7)

**Status:** Acknowledged, not exploitable in Flow Weaver's threat model.

| Dependency | Version | Fixed in |
|---|---|---|
| `glob` | 10.5.0 (minimatch 9.0.5) | glob 13+ (breaking API change) |
| `ts-morph` | 21.0.1 (minimatch 9.0.5) | Waiting on upstream update |

**Why this is low risk for Flow Weaver:**

The vulnerability requires an attacker to supply a malicious glob pattern with 15+ consecutive wildcards. In Flow Weaver, glob patterns originate from:

- **CLI arguments** — supplied by the local user (self-controlled)
- **MCP tools** — patterns from IDE integrations (trusted context)
- **Workflow file discovery** — patterns from local config files

There is no network-facing path where an untrusted user can supply a glob pattern. The CLI user would be attacking themselves.

**Tracking:** We will upgrade `glob` and `ts-morph` when compatible versions are available.
