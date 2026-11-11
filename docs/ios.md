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
- **Purchases.** Pro is sold through App Store in-app purchase. Polar checkout never opens in the app.

## Not done yet

- Accounts: an absolute API origin and token sessions. Cookies do not cross from `capacitor://localhost`.
- Google sign-in through the system browser (`ASWebAuthenticationSession`) with a return deep link.
- StoreKit purchase of Pro, verified by the server and attached to the Tactics Journal account.
- App icon, launch screen, signing and TestFlight.
