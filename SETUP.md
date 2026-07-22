# Setup

One-time setup for a fresh clone: Google OAuth credentials, then the first build.

Budget ~15 minutes. Most of it is clicking through the Google Cloud console.

> **Never commit real credentials.** `.env` is gitignored (`.gitignore` line 27) and
> must stay that way. Every client ID in this document is fake — substitute your own.

---

## Prerequisites

| Requirement | Notes |
| --- | --- |
| macOS + Xcode 16+ | Accept the licence first: `sudo xcodebuild -license accept` |
| iOS Simulator runtime | See [Xcode can't find a simulator](#xcode-cant-find-a-simulator) if destinations come up empty |
| Node 20+ | |
| Google account | The one whose Drive holds your footage |
| ~15 GB free disk | Pods, DerivedData, and a simulator runtime are not small |

Rushmark ships a custom native module (`modules/frame-player/`), so **Expo Go cannot
run it**. Every path below builds a dev client.

---

## 1. Install dependencies

```bash
npm install
```

## 2. Create the Google Cloud project

Go to [console.cloud.google.com](https://console.cloud.google.com) → project dropdown →
**New Project** → name it `Rushmark` → **Create**.

Confirm it's the selected project before continuing.

## 3. Enable the Drive API

**APIs & Services → Library** → search **"Google Drive API"** → **Enable**.

Skipping this produces the most confusing failure mode there is: sign-in succeeds,
then every Drive call returns `403 insufficientPermissions`.

## 4. Configure the consent screen

Listed as **Google Auth Platform** in the current console (older guides call it
"OAuth consent screen").

1. **Audience** → **External**. (Internal only exists for Workspace organisations.)
2. App name `Rushmark`; your own address for both support and developer contact.
3. **Data access → Add or remove scopes → Add manually**, paste exactly:

   ```
   https://www.googleapis.com/auth/drive
   ```

4. **Audience → Test users → + Add users** → add **your own Google account**.

### Why full `drive` scope, and why test users matter

`drive.file` — the scope Google nudges you toward — only exposes files the app itself
created. Rushmark's entire premise is authoring metadata for footage you shot and
uploaded some other way, which `drive.file` cannot see at all. So full `drive` is
required, not over-reach. See the header comment in
[`src/features/auth/googleAuth.ts`](./src/features/auth/googleAuth.ts).

The cost: `.../auth/drive` is a **restricted** scope. An unverified app may only be
used by accounts on the Test users list. Leave publishing status on **Testing** —
that is the correct end state for a personal app and avoids Google's verification
review entirely.

## 5. Create the iOS OAuth client

**Credentials → + Create Credentials → OAuth client ID**

- Application type: **iOS**
- Bundle ID: **`com.rushmark.app`**

The bundle ID must match `ios.bundleIdentifier` in [`app.config.ts`](./app.config.ts)
exactly. A mismatch surfaces later as `DEVELOPER_ERROR` (code 10).

You get an **iOS client ID** shaped like:

```
123456789012-abcdefghijklmnopqrstuvwxyz123456.apps.googleusercontent.com
```

## 6. Create the Web OAuth client

**+ Create Credentials → OAuth client ID** → **Web application** → name it
`Rushmark Web` → **Create**. No redirect URIs needed.

Optional in practice: `googleAuth.ts` sets `offlineAccess: false` and never reads
`idToken`, which is the only thing `webClientId` enables. Sign-in works with
`GOOGLE_WEB_CLIENT_ID` left blank. Create it anyway — it costs seconds and the
library documents it as required.

## 7. Derive the iOS URL scheme

This is the step people get wrong. It is **not** a character reverse — you flip the
*dot-separated domain segments* and leave the ID itself alone:

```
iOS client ID:  123456789012-abcdefghijklmnop.apps.googleusercontent.com
                └────────── unchanged ──────┘ └──── reversed ────┘

URL scheme:     com.googleusercontent.apps.123456789012-abcdefghijklmnop
```

Don't build it by hand. Google prints it for you: open the iOS client's detail page
and copy the field labelled **iOS URL scheme**.

It must begin with `com.googleusercontent.apps.` — the config plugin hard-fails
otherwise, and that failure is more disruptive than it looks (see
[troubleshooting](#sign-in-fails-with-your-app-is-missing-support-for-the-following-url-schemes)).

## 8. Write `.env`

```bash
cp .env.example .env
```

Fill it in — no quotes, no spaces around `=`, no trailing whitespace:

```bash
GOOGLE_IOS_CLIENT_ID=123456789012-abcdefghijklmnop.apps.googleusercontent.com
GOOGLE_WEB_CLIENT_ID=123456789012-zyxwvutsrqponmlk.apps.googleusercontent.com
GOOGLE_IOS_URL_SCHEME=com.googleusercontent.apps.123456789012-abcdefghijklmnop
```

Those three keys are the whole contract. In particular there is **no client secret** —
Rushmark has no backend, nothing reads one, and a secret embedded in a mobile binary
is extractable by anyone who downloads it. If you pasted one in, delete it.

## 9. Build and run

```bash
npx expo prebuild -p ios
npx expo run:ios
```

Pick an **iPhone simulator** when prompted. Simulator builds need no code signing;
physical devices do (see [below](#physical-device-build-fails-on-code-signing)).

Verify the scheme actually landed in the native project:

```bash
grep -A2 CFBundleURLSchemes ios/Rushmark/Info.plist
```

You should see your real scheme. If it still says `PLACEHOLDER`, prebuild did not
complete — read the [troubleshooting](#troubleshooting) section rather than rebuilding
blindly.

Leave the terminal running; that's Metro. Press `i` to reopen, `r` to reload.

## 10. First sign-in

Tap **+** on the folder list. Expect, in order:

1. **"Google hasn't verified this app"** → **Advanced → Go to Rushmark (unsafe)**.
   Expected and unavoidable for an unpublished app using a restricted scope.
2. **A checkbox granting Drive access** — you must tick it. Declining leaves you
   apparently signed in while every Drive call fails, which is exactly why
   `hasDriveScope()` exists.
3. Your Drive folders become pickable.

Testing-mode credentials expire after roughly **7 days**. Re-signing in weekly is
normal, not a regression.

---

## When credentials change

`.env` is read at **build** time, not runtime. The URL scheme is compiled into native
`Info.plist`; the client IDs are baked into the app manifest via `extra` in
`app.config.ts`.

So after editing `.env`, a Metro reload changes nothing. You need:

```bash
npx expo prebuild -p ios
npx expo run:ios
```

---

## Troubleshooting

### Sign-in fails with "Your app is missing support for the following URL schemes"

`Info.plist` still contains `com.googleusercontent.apps.PLACEHOLDER`.

The usual cause is a malformed `GOOGLE_IOS_URL_SCHEME`. When the value doesn't start
with `com.googleusercontent.apps`, the config plugin **throws**, which **aborts
prebuild before it writes `Info.plist`** — leaving the placeholder in place. A
subsequent `run:ios` then happily builds and installs that stale binary, so the
symptom appears at sign-in rather than at build time.

Fix `.env`, then re-run prebuild and confirm:

```bash
grep -c PLACEHOLDER ios/Rushmark/Info.plist   # must print 0
```

To check what the config actually resolves to before building:

```bash
npx expo config --type prebuild | grep iosUrlScheme
```

### `Error: Cannot find module 'babel-preset-expo'`

npm sometimes leaves the package nested at `node_modules/expo/node_modules/` instead
of hoisting it. Babel resolves presets relative to `babel.config.js` in the project
root, so a nested copy is invisible — the module is on disk but unreachable.

It's declared explicitly in `package.json` to force the hoist. If it recurs:

```bash
npm install --save-dev babel-preset-expo@~54.0.12
npm ls babel-preset-expo    # expect a root-level entry, "deduped" under expo
```

### `DEVELOPER_ERROR` / status code 10

Bundle ID mismatch. The iOS OAuth client must be registered for exactly
`com.rushmark.app`.

### `403 insufficientPermissions` on Drive calls

The Drive API isn't enabled for the project ([step 3](#3-enable-the-drive-api)).

### `access_denied` at the consent screen

Your account isn't on the Test users list ([step 4](#4-configure-the-consent-screen)).

### Xcode can't find a simulator

`xcodebuild` reports no eligible destinations even though `xcrun simctl list` shows
booted devices. Xcode refuses to build against a simulator runtime that doesn't match
its bundled SDK.

```bash
xcodebuild -downloadPlatform iOS
```

No `sudo` required. It's a large download (~8.5 GB) — check free space first.

### Physical device build fails on code signing

```
CommandError: No code signing certificates are available to use.
```

Expected on a fresh machine. Open Xcode → **Settings → Accounts** → add your Apple ID,
then select the team under the Rushmark target's **Signing & Capabilities**. A free
Apple ID works; provisioning expires every 7 days.

Simulator builds need none of this, so prefer them unless you're specifically
validating frame-accurate playback on real hardware.

### `pod install` fails on modular headers

```
The Swift pod `AppCheckCore` depends upon `GoogleUtilities` and
`RecaptchaInterop`, which do not define modules.
```

Handled by the `extraPods` entry in the `expo-build-properties` block of
`app.config.ts`, which forces module maps for just those two pods rather than
switching the whole pod graph to frameworks. If you hit it anyway, confirm the
generated `ios/Podfile` actually contains `modular_headers` — a non-clean prebuild
reuses the existing Podfile and can skip the change.

---

## See also

- [`specs/001-drive-video-metadata/quickstart.md`](./specs/001-drive-video-metadata/quickstart.md)
  — validation scenarios and test suites
- [`.specify/memory/constitution.md`](./.specify/memory/constitution.md) — the three
  non-negotiable principles
