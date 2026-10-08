# Linux sandbox acceptance

DemoForge keeps the Electron editor and the workflow Chromium browser in separate processes. Both must run with their Chromium sandbox enabled. Linux package acceptance also checks the Electron setuid sandbox helper installed from the fresh archive.

## Ubuntu 24.04 CI

Ubuntu 24.04 restricts unprivileged user namespaces through AppArmor. On its disposable runner, CI enables that restriction and verifies it, then loads named AppArmor profiles that grant only the `userns` permission to these exact executable path patterns:

- The checkout's `node_modules/electron/dist/electron` for source Electron tests.
- The pinned Playwright cache's `chromium-*/chrome-linux64/chrome` and `chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell` for source workflow browser tests.
- The package smoke harness's temporary `app-data/browser-runtime` copies of those two downloaded Chromium executables.

The profiles use AppArmor's `unconfined` mode with only the `userns` rule. They do not disable the system-wide restriction, grant user namespace access to other executables, or pass `--no-sandbox`. The package smoke harness runs with `TMPDIR` set to the runner's temporary directory so its browser path remains under the profile's named `demoforge-package-smoke-*` scope. Linux apt downloads use two retries, a 30-second per-request timeout, and bounded installation steps; all browser and media/display dependencies remain required.

CI extracts the Linux archive under `/opt/demoforge-ci`, makes the directory root-owned, sets the archive's `chrome-sandbox` to owner `root:root` and mode `4755`, verifies those attributes, and runs acceptance as the ordinary runner user. The archive helper is used for packaged Electron; AppArmor profiles separately allow the downloaded workflow Chromium under the harness-owned temporary application data directory.

## Linux installation requirements

Use an x64 Linux system with a working X11 or Wayland session (or a virtual display for headless acceptance), the shared libraries required by Electron and the downloaded Chromium build, and an install filesystem that permits setuid execution. Extract the archive to a root-owned, non-user-writable location, set `chrome-sandbox` to `root:root` mode `4755`, and launch as a regular user. Do not run DemoForge as root.

On Ubuntu 24.04 and other systems that restrict unprivileged user namespaces, the downloaded Chromium runtime also needs a root-owned AppArmor profile that grants `userns` to the exact resolved browser executable paths under `app.getPath('userData')/browser-runtime`. The runtime uses versioned `chromium-*` and `chromium_headless_shell-*` directories, so update the profile when the installed runtime path changes. Consult the [Chromium AppArmor user namespace guidance](https://chromium.googlesource.com/chromium/src/+/main/docs/security/apparmor-userns-restrictions.md) and [Ubuntu 24.04 release notes](https://documentation.ubuntu.com/release-notes/24.04/) for the supported profile model. Disabling this restriction globally or passing `--no-sandbox` is not an acceptance workaround.

Windows CI checks the packaged Electron launch configuration and renderer sandbox preference. Linux CI additionally exercises the root-owned setuid helper and uses AppArmor profiles while testing source Electron and downloaded Chromium. A passing job establishes acceptance on the listed Windows runner and Ubuntu 24.04 CI image; it does not establish support for every Linux distribution, filesystem, desktop environment, or AppArmor policy.
