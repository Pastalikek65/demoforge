# Packaging, setup, and acceptance

DemoForge packages the Electron editor and its application files. It does not include the workflow Chromium browser or the export FFmpeg executable. On first launch, use **Install browser** in the local requirements panel. DemoForge runs its pinned Playwright installer and downloads the browser runtime into `browser-runtime` under Electron's per-user application data directory. An internet connection and valid system TLS certificates are required for this one-time setup; recordings, replay, and exports then run locally. The installer writes `install.log` in that runtime directory. The separate export FFmpeg must be installed on the machine and must support `libx264` and the `subtitles` filter. Set `DEMOFORGE_FFMPEG` to its absolute path when it is not available as `ffmpeg` on `PATH`.

On Linux, use an x64 machine with a working X11 or Wayland desktop session and the GTK, NSS, audio, and graphics shared libraries required by Electron and the downloaded Chromium version. The browser setup downloads Chromium but does not install operating-system packages. Playwright's Linux dependency list changes with its browser version; see the [official system-dependency instructions](https://playwright.dev/docs/browsers#install-system-dependencies), or run `npx playwright install-deps chromium` from a checkout with the pinned dependencies installed. A headless CI runner can provide a virtual display with `xvfb-run`. The package does not install operating-system libraries or FFmpeg. The acceptance harness checks the selected FFmpeg for the required encoder and filter and fails if either is missing.

## Package license inventory

After installing project dependencies, run:

```sh
node scripts/license-inventory.mjs
```

The command writes `artifacts/licenses/license-inventory.json` and `artifacts/licenses/license-inventory.md`. Use `--output <directory>` to write both files elsewhere, or `--root <directory>` to inventory another DemoForge checkout. The inventory lists every `node_modules` package-lock entry, prefers its installed `package.json` license declaration, and falls back to lock metadata. `UNKNOWN` means neither source supplied a declaration; it does not determine which license terms apply.

The package bundles the Playwright JavaScript driver, while the Playwright installer downloads Chromium into the user's application data directory. That downloaded runtime is not included in this inventory. If legacy browser or helper cache folders exist under `artifacts/runtime`, the inventory identifies them as development caches excluded from current packages. Review the applicable Playwright and browser notices separately before redistribution. The external export FFmpeg executable is also outside this inventory; its source, notices, and codec build depend on the executable selected on each machine.

## Build and extract

Run `npm run package` on the target operating system. The current builder configuration creates a Windows x64 ZIP or a Linux x64 `tar.gz` in `release/`. Extract the archive into a fresh directory before launching the app or running acceptance; the smoke harness accepts the executable path and does not extract archives itself.

Windows example:

```powershell
npm run package
New-Item -ItemType Directory -Path artifacts/install | Out-Null
Expand-Archive -LiteralPath release/DemoForge-0.1.0-win-x64.zip -DestinationPath artifacts/install
node scripts/package-smoke.mjs "$pwd/artifacts/install/DemoForge.exe" --ffmpeg "C:\path\to\ffmpeg.exe"
```

For an ordinary Linux installation, extract into a root-owned, non-user-writable directory, make Electron's `chrome-sandbox` helper root-owned with mode `4755`, and launch DemoForge as the regular desktop user. The install filesystem must permit setuid execution; do not run the application as root.

```sh
sudo mkdir -p /opt/demoforge
sudo tar --no-same-owner -xzf release/DemoForge-0.1.0-linux-x64.tar.gz -C /opt/demoforge
sudo chown -R root:root /opt/demoforge
sudo chmod -R go-w /opt/demoforge
sandbox=$(find /opt/demoforge -type f -name chrome-sandbox -print -quit)
test -n "$sandbox"
sudo chmod 4755 "$sandbox"
executable=$(find /opt/demoforge -type f -name demoforge -print -quit)
"$executable"
```

Linux package acceptance, from an X11 or Wayland session, uses the same install permissions:

```sh
npm run package
sudo mkdir -p /opt/demoforge-ci
sudo tar --no-same-owner -xzf release/DemoForge-0.1.0-linux-x64.tar.gz -C /opt/demoforge-ci
sudo chown -R root:root /opt/demoforge-ci
sudo chmod -R go-w /opt/demoforge-ci
sandbox=$(find /opt/demoforge-ci -type f -name chrome-sandbox -print -quit)
test -n "$sandbox"
sudo chmod 4755 "$sandbox"
executable=$(find /opt/demoforge-ci -type f -name demoforge -print -quit)
node scripts/package-smoke.mjs "$executable" --ffmpeg /usr/bin/ffmpeg
```

On a headless Linux runner, wrap the acceptance command in `xvfb-run --auto-servernum`. Use the archive's actual versioned filename and the executable inside its extracted directory. The smoke command must run as an ordinary user from the DemoForge checkout with its dependencies installed because it uses the pinned Playwright driver to open the downloaded browser and inspect the exports. It requests Chromium sandboxing explicitly for the packaged Electron app and the export-inspection browser, and fails if Electron starts with `--no-sandbox` or the editor renderer does not report sandboxing enabled. During both recording and replay it inspects only processes descended from that packaged app, fails if the workflow Chromium disables its sandbox, and records each renderer's Seccomp mode and namespace identifiers as acceptance evidence. Do not use `--no-sandbox` to work around an incorrect helper owner or mode.

## Installed-package acceptance

The smoke harness runs on Windows x64 and Linux x64. It launches the supplied executable with an isolated `--user-data-dir` profile argument, requires Electron to report `app.isPackaged`, and confirms that the first-run requirements panel offers browser setup. It installs Chromium through the editor UI, checks that progress is shown and project controls stay locked during installation, then verifies the downloaded runtime under that isolated user-data directory.

The harness creates its own temporary profile, synthetic project, export directory, and ephemeral localhost shops. It starts and stops an actual recording in the packaged editor against a delayed synthetic page that fills a normal field, fills a password field, selects an option, and clicks a button. It saves and reopens that recorded project, checks that both the tokenized starting URL and password are secret variable references rather than persisted values, and replays the recorded workflow. It then opens, edits, saves, and reopens a five-step fixture project, enters a synthetic secret canary, and replays every step. After checking the raw preview, it adds a timed opaque mask and caption, marks the recording reviewed, and exports MP4, GIF, Markdown, and HTML. FFmpeg decodes the media and PNG frames, checks mask pixels in MP4, GIF, and the shared PNG frames used by both guides, and checks caption pixels in MP4. The harness scans the saved projects and every exported file for their secret canaries, confirms raw capture media is absent, and opens the HTML, PNG frames, and GIF in the downloaded Chromium runtime.

Progress stages and failures are written to stderr; a successful run prints a JSON evidence object to stdout. The command exits nonzero when a prerequisite or acceptance check fails and does not skip unavailable checks. Capture both output streams when saving a run log. Acceptance on one Windows or Linux distribution does not establish support for every distribution or desktop environment.

## Signing and checksums

Current Windows ZIPs and Linux archives are unsigned. The Windows executable is also not code-signed (`signAndEditExecutable` is disabled). Windows may identify the publisher as unknown; an unsigned package provides no publisher signature to validate. Do not treat a successful smoke run as a signature or provenance check.

Generate SHA-256 checksums for archives in `release/` with:

```sh
node scripts/checksums.mjs
```

The command writes `release/SHA256SUMS.txt`. Verify the listed hash against the archive you received. A checksum detects a mismatch only when the expected manifest itself came from a trusted release channel.
