# Local performance measurement

DemoForge's benchmark replays a 25-step synthetic shop checkout against an HTTP server bound to loopback, records a 1280×720 browser video and one screenshot per step, then exports MP4, GIF, Markdown, and HTML. Each browser action uses an 80 ms pause. The fixture and all inputs are local and synthetic; the card number is a test value.

Run it from the repository root after building the app, using Node.js 24 LTS. On Windows, set `DEMOFORGE_FFMPEG` to the path of your own FFmpeg executable if it is not on `PATH`:

```powershell
$env:DEMOFORGE_FFMPEG = 'C:\path\to\ffmpeg.exe'
npm run build
node scripts/benchmark.mjs
```

The script writes a detailed JSON result to `artifacts/performance-benchmark.json`. Set `DEMOFORGE_BENCHMARK_OUTPUT` to choose another location.

## Recorded run

The following values came from one run on 2026-10-08 at 19:20:42 UTC with the bounded two-animation-frame screenshot readiness wait. They describe this machine and this synthetic workflow; they are not cross-platform performance claims or a controlled comparison with earlier versions. The retained result is `artifacts/performance-capture-readiness.json`.

| Measurement | Result |
| --- | ---: |
| Host | Windows 10.0.26300, x64 |
| Processor | AMD Ryzen 9 8945HX with Radeon Graphics, 32 logical CPUs |
| Node.js | v24.21.0 |
| Viewport | 1280×720 |
| Workflow | 25 steps, 80 ms pause after browser actions |
| Recorded input duration | 3,571 ms |
| Replay wall clock | 3,946.6 ms |
| Export wall clock | 3,275.4 ms |
| Capture output | 1,220,913 bytes total; 486,468-byte WebM and 25 screenshots |
| MP4 | 159,200 bytes |
| GIF | 795,276 bytes |
| All export output | 1,592,769 bytes, including guide files and 25 step images |
| Node RSS sampled peak during replay | 154,513,408 bytes (about 147.4 MiB) |
| Node RSS sampled peak during export | 159,543,296 bytes (about 152.2 MiB) |

The benchmark measures each phase with `performance.now()` and samples this Node process's RSS every 20 ms. The RSS values exclude the separately spawned Chromium and FFmpeg processes, so they do not represent total application memory. The sample interval can also miss brief peaks. Replay includes browser startup, workflow execution, screenshots, and video finalization; export includes FFmpeg processing and guide generation.
