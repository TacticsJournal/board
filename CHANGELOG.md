# Changelog

## Unreleased

- Added the official 3D View extension with full-circle mouse and touch orbit controls, camera zoom, and the editable live board.
- Added a bundled official extension registry separate from sandboxed self-hosted extensions.
- Added a self-host settings page and clarified that Board does not use tracking or analytics.
- Shortened Board share links and let free users import shared projects.
- Sorted the player picker by shirt number and remembered the last opened project separately.
- Fixed animation export fades, duplicated arrow alignment, broadcast arrow previews, shape controls, and shape refreshes after switching project type.
- Kept the board hidden behind the mobile keyboard toolbar.

## [0.1.1] - 2026-08-26

- Added a prebuilt Docker image, Compose configuration, and versioned self-host release archives.
- Added a release workflow for GitHub release assets, GHCR images, and image provenance.
- Added a CI Docker image build without registry publishing.

## [0.1.0] - 2026-08-26

Initial MIT open-source release of Tactics Journal Board.

- Mobile-friendly tactics board editor with players, balls, arrows, zones, labels, pitch styles, saves, and PNG export.
- Browser screenshot import with heuristic detection, manual marks and corners, and homography mapping.
- Static self-host build with local extension packaging.
- Clear separation between MIT-covered code, third-party material, and reserved trademarks.
