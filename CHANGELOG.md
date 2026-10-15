<!--
What's new, in the words the reader sees. This file is the only source of
truth: the board and the /changelog page are both built from it.

One entry per `## ` heading, newest first. The heading is the title. The
lines under it, up to the first blank line, are fields written as
`Key: value`:

  Date   required, ISO `YYYY-MM-DD`
  Tag    optional, one short word shown as a pill, for example New or Fixed
  Major  optional, `true` to announce the entry in a banner on the board

Everything after the blank line is the body: one or two sentences, or
nothing at all. An entry missing a title or a valid date is skipped, and a
file that cannot be read leaves the list empty rather than failing a build.
-->

## Style a zone, an arrow and a label one tab at a time
Date: 2026-09-06
Tag: Improved

Styles opens on the part you are working on, so the controls for a zone, an arrow and a label no longer share one crowded shelf.

## 3D View
Date: 2026-08-26
Tag: New
Major: true

Orbit the pitch with a finger and keep editing the live board while you turn it. Pinch to zoom in on a phase and see the shape from the touchline.

## Oval and triangle edit controls now match the box controls
Date: 2026-08-26

Reshaping an oval or a triangle works the same way as reshaping a box, with the same handles in the same places.

## The board remembers the last project you opened
Date: 2026-08-26

The last project and the last board are remembered separately, so reopening the board puts you back where you left off.

## The player picker sorts by shirt number
Date: 2026-08-26

Squads read in number order, so finding a player is a glance instead of a scan.

## New arrows default to the round curve preset
Date: 2026-08-25

Draw an arrow and it bends the way most passes and runs do, without a trip to the curve settings.

<!-- Self-host release history. These headings have no Date field, so the
board changelog skips them. -->

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
