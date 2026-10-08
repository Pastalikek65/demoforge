# Third-party components

DemoForge's own code is Apache-2.0. Dependencies retain their original licenses. Packages include a locked dependency inventory and complete production dependency license texts under `resources/licenses`. Electron's Chromium/Node attribution also accompanies its runtime.

| Component | Role | License |
|---|---|---|
| Playwright | Browser automation | Apache-2.0 |
| React/React DOM | Local editor | MIT |
| Electron | Desktop runtime | MIT; includes Chromium/Node notices |
| Commander | CLI | MIT |
| Zod | Runtime validation | MIT |
| Chrome for Testing and recording helper | Separate one-time vendor download | Vendor terms and component licenses; not redistributed in DemoForge packages |
| FFmpeg | Separately installed media encoder | Build-dependent LGPL/GPL; not bundled |

The development host's FFmpeg 7.1 build enables GPL/v3 and libx264. This executable is used for local tests and is not redistributed as Apache-licensed project code. Users/installers must comply with the license of the FFmpeg build they choose.

Browser setup uses the locked Playwright CLI to download its matching browser directly into the user's application data folder. [Chrome executable terms](https://www.google.com/intl/en/chrome/terms/) apply separately; component notices are available through `chrome://credits`. The [Chrome for Testing repository](https://github.com/GoogleChromeLabs/chrome-for-testing) documents official binary sources. The Apache-2.0 license of its download infrastructure does not relicense the browser binary.

The full development dependency audit currently reports eight moderate `sprintf-js` advisories through Electron build tooling. Production dependencies have no reported vulnerabilities. A downgrade suggested by the audit would introduce high and critical build-tool vulnerabilities and has not been applied. See the lockfile for exact versions; revisit upstream fixes before each release.
