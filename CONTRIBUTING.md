# Contributing

Thanks for taking the time to improve Tactics Journal Board. Small, focused pull requests are easiest to review.

## First contribution

1. Fork or clone [the repository](https://github.com/TacticsJournal/board).
2. Install Node 24 and run the clean setup:

   ```bash
   nvm install
   nvm use
   npm ci
   ```

3. Make one focused change.
4. Run the checks:

   ```bash
   npm test
   npm run build
   npm run build:self-hosted
   ```

5. Open a pull request and describe the behavior you changed, the checks you ran, and any limits you found.

The default development server is `npm run dev`. Do not use real account data or commit secrets, local exports, credentials, or generated `dist/` files.

## What to include

- Update the relevant documentation when behavior or configuration changes.
- Add or update tests when a code change has a testable behavior.
- Keep third-party material under its own terms and record new material in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- Do not add the excluded model, copied runtime, or broadcast screenshots to a pull request.
- Keep Tactics Journal and Tactics Board trademark rules in [TRADEMARKS.md](TRADEMARKS.md) in mind when changing names, logos, or examples.

## Pull requests

Use the pull request template. Keep the title specific and explain why the change is needed. A maintainer may ask for a smaller patch, documentation changes, or a license note before review.

By contributing, you agree that your contribution is provided under the MIT license in [LICENSE](LICENSE), unless you state another arrangement before it is accepted.

For security issues, do not open a public issue. Follow [SECURITY.md](SECURITY.md).
