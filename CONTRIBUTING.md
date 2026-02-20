# Contributing to Flow Weaver

Thank you for your interest in contributing to Flow Weaver.

## Developer Certificate of Origin (DCO)

All contributions to this project must be signed off under the [Developer Certificate of Origin (DCO) v1.1](https://developercertificate.org/). By signing off, you certify that you have the right to submit the contribution and agree that it may be redistributed under the project's license terms, including future dual-licensing.

To sign off, add a `Signed-off-by` line to your commit message:

```
git commit -s -m "Add new feature"
```

This produces:

```
Add new feature

Signed-off-by: Your Name <your.email@example.com>
```

All commits must include this sign-off. Unsigned commits will be rejected.

## License Agreement

This project is licensed under a custom license based on the Elastic License 2.0 (ELv2).
See [LICENSE](./LICENSE) for the full terms. Notably: free to use for any organization,
free to host internally for organizations with 15 or fewer people, external hosting as a
service to third parties is prohibited without a commercial license.

By contributing, you agree that:

1. Your contribution is your original work (or you have the right to submit it).
2. You grant the project maintainer (Ricardo Jose Horta Morais / Synergenius) a perpetual, worldwide, non-exclusive, royalty-free license to use, reproduce, modify, sublicense, and distribute your contribution under any license terms, including commercial licenses.
3. This grant allows the maintainer to offer the project under dual licensing (ELv2 and a commercial license) without requiring further permission from you.

## Getting Started

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-change`)
3. Make your changes
4. Run the tests (`npm test`)
5. Commit with sign-off (`git commit -s -m "Description of change"`)
6. Push and open a pull request

## Code Style

- Follow the existing code patterns
- Run `npm run lint` before submitting
- Run `npm run typecheck` to verify type safety

## Reporting Issues

Open an issue on GitHub with:
- A clear description of the problem
- Steps to reproduce
- Expected vs actual behavior
- Version of Flow Weaver you're using
