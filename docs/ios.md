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

## What differs in the app

`src/native.ts` exposes `IS_NATIVE_APP`.

- **Exports.** The app has no downloads. PNG, GIF, video, project images and JSON backups open the iOS share sheet, which offers Save Image, Save to Files and AirDrop.
- **Requests.** `src/app-net.ts` sends every request through the native HTTP stack, so the Tactics Journal session cookie lives in the app's own cookie jar. Relative `/api/` paths go to `https://board.tacticsjournal.com`. Each request carries the Board origin, because the server's write guards check it. Share and live links use the website's address through `webOrigin()` in `src/app-origin.ts`, never `capacitor://localhost`.
- **Sign-in.** Settings → Account opens the app's own sign-in: Sign in with Apple, Google in the system sign-in sheet, or an email code. Each one ends with the website's normal session. `src/native-account.ts` is the web half and `ios/App/App/BoardNative.swift` is the native half.
- **Purchases.** Pro is an App Store subscription: monthly or yearly, with Restore purchases and Apple's subscription terms. Polar checkout never opens in the app. Tactics Journal reads each purchase back from Apple before it grants Pro. A member whose Pro comes from the App Store manages it in the App Store's own subscription settings. The server side is described in the site's `docs/pro/app-store-billing-runtime.md`.

## Setup outside the repo

- Apple Developer: the Sign in with Apple capability for `com.tacticsjournal.board`. The entitlement is already in `ios/App/App/App.entitlements`.
- App Store Connect: one subscription group holding `com.tacticsjournal.board.pro.monthly` ($14.99) and `com.tacticsjournal.board.pro.yearly` ($155.99), plus the Server Notifications V2 address and an In-App Purchase key for the site.

## Not done yet

- Live sync and collaboration sockets in the app have not been tested with a signed-in session.
- App icon, launch screen, signing and TestFlight.
