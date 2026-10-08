# Third-party components

DemoForge's own code is Apache-2.0. Dependencies retain their original licenses. The locked dependency/license inventory and complete distributed notices will be generated before a stable release.

| Component | Role | License |
|---|---|---|
| Playwright | Browser automation | Apache-2.0 |
| React/React DOM | Local editor | MIT |
| Electron | Desktop runtime | MIT; includes Chromium/Node notices |
| Commander | CLI | MIT |
| FFmpeg | Separately installed media encoder | Build-dependent LGPL/GPL; not bundled |

The development host's FFmpeg 7.1 build enables GPL/v3 and libx264. This executable is used for local tests and is not redistributed as Apache-licensed project code. Users/installers must comply with the license of the FFmpeg build they choose. Electron distribution license/notice files must accompany packages.
