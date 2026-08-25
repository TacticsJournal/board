# Third-party notices

This file identifies third-party material that is present in, generated for, or referenced by the 0.1.0 release. The MIT license in [LICENSE](LICENSE) does not replace these terms.

## Tabler Icons

The interface icons come from [Tabler Icons](https://tabler.io/icons), copyright 2020-2026 Paweł Kuna. They are used under the MIT license. The license text shipped with the app is [`public/LICENSE-icons`](public/LICENSE-icons).

## Match fixture

`scripts/fixtures/match-real.jpg` is "Football match at the i2i Stadium" by Bill Boaden, via Geograph Britain and Ireland and Wikimedia Commons. It is available under [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0/). Source page: [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Football_match_at_the_i2i_Stadium_-_geograph.org.uk_-_5307336.jpg). Keep the attribution and share-alike terms when redistributing it.

## TheSportsDB data

`public/teams-index.json` was generated from official TheSportsDB API endpoints and contains API-returned team data. TheSportsDB's terms allow API-returned content to be copied and modified with source credit. Credit TheSportsDB when using or republishing this data, and check the [current TheSportsDB terms](https://www.thesportsdb.com/docs_terms_of_use.php) before redistribution.

The app requests current squad information from Wikipedia at runtime. That data is not bundled in this repository. A deployment or user who republishes returned data must follow the terms and attribution requirements that apply to the relevant Wikipedia and Wikimedia sources.

## npm dependencies

The direct packages listed by the release lockfile keep their upstream licenses. `npm ci` obtains them from npm and does not relicense them under this repository's MIT notice.

- [Polar checkout](https://github.com/polarsource/polar) uses Apache-2.0.
- [Konva](https://github.com/konvajs/konva) uses MIT.
- [TypeScript](https://github.com/microsoft/TypeScript) uses Apache-2.0.
- [Vite](https://github.com/vitejs/vite) uses MIT.
- [Playwright](https://github.com/microsoft/playwright) uses Apache-2.0 for the test tooling.

Transitive packages have their own notices in npm package metadata. Consult the package-lock metadata before making a redistribution that includes installed dependencies.
