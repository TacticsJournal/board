# iOS app

Board ships to iPhone and iPad as a Capacitor app. The Xcode project in `ios/` wraps the hosted bundle from `dist/`.

## Build and run

You need Xcode and Node 24.

```bash
npm install
npm run ios:sync   # vite build, then copy dist/ into the Xcode project
npm run ios:open   # open the project in Xcode, then pick a device and Run
```

`npm run ios:run` builds and launches on a connected device or simulator from the terminal.

Run `npm run ios:sync` after every web change. The app does not load the website; it runs the copy bundled at sync time.

## TestFlight

```bash
ios/beta                # build origin/main and upload it for internal testers
ios/beta upload:false   # only build it, into a temporary folder
```

It works the way LocalDeck's `ios/beta` and Divernote's `ios/alpha` do. Fastlane builds exactly what is on GitHub's `main`, in a temporary worktree, whatever the local checkout looks like. There it runs `npm ci`, `vite build` and `cap sync ios`, then archives. The build number is `main`'s commit count, so it only grows. If App Store Connect already has that number, the export raises it past the latest upload. `BUILD_NUMBER=… ios/beta` overrides it. The version comes from `MARKETING_VERSION` in the Xcode project.

The archive is built unsigned and signed on export, which needs a distribution profile but no registered device. Signing is manual, because automatic signing needs an Apple account in Xcode and this Mac has none. It uses:

- the Apple Distribution identity in Divernote's `divernote-signing.keychain`, set up by Divernote's `ios/signing-keychain`. `ios/beta` asks for its password.
- the App Store profile **"Board"**.

The unsigned archive carries no entitlements, so the lane signs the app ad hoc with `ios/App/App/App.entitlements` before the export, as Divernote's `ios/full` does. It refuses to upload a build that lost Sign in with Apple.

The upload goes through `board-upload`, so the App Store Connect key never leaves its root-only file in `/etc/agent-secrets`, the same one `divernote-upload` reads. The command accepts only a `com.tacticsjournal.board` build in `~/board-builds`.

Once per Mac:

1. On developer.apple.com, register the App ID: Identifiers → + → App IDs → App, Explicit bundle ID `com.tacticsjournal.board`, with **Sign in with Apple** checked. In-App Purchase is on for every App ID.
2. On developer.apple.com, make the profile: Profiles → + → App Store Connect → `com.tacticsjournal.board` → the Apple Distribution certificate. Name it `Board`, download it and double-click it. Make it again whenever a capability changes.
3. In App Store Connect, create the **Board** app record for bundle ID `com.tacticsjournal.board`.
4. Install the upload command: `sudo ios/upload-broker/install-upload`.

Internal testing skips Beta App Review, so a build can be installed minutes after it finishes processing. Builds expire after 90 days.

## What differs in the app

`src/native.ts` exposes `IS_NATIVE_APP`.

- **Exports.** The app has no downloads. PNG, GIF, video, project images and JSON backups open the iOS share sheet, which offers Save Image, Save to Files and AirDrop.
- **Purchases.** Pro is sold through App Store in-app purchase. Polar checkout never opens in the app.

## Not done yet

- Accounts: an absolute API origin and token sessions. Cookies do not cross from `capacitor://localhost`.
- Google sign-in through the system browser (`ASWebAuthenticationSession`) with a return deep link.
- StoreKit purchase of Pro, verified by the server and attached to the Tactics Journal account.
- App icon and launch screen.
