# Local performance measurement

DemoForge's benchmark replays a 25-step synthetic shop checkout against an HTTP server bound to loopback, records a 1280×720 browser video and one screenshot per step, then exports MP4, GIF, Markdown, and HTML. Each browser action uses an 80 ms pause. The fixture and all inputs are local and synthetic; the card number is a test value.

Run it from the repository root after building the app. On Windows, the measured run used the local FFmpeg executable through `DEMOFORGE_FFMPEG`:

```powershell
$env:DEMOFORGE_FFMPEG = 'C:\Users\mamid\AppData\Local\Programs\Python\Python312\Lib\site-packages\imageio_ffmpeg\binaries\ffmpeg-win-x86_64-v7.1.exe'
npm run build
node scripts/benchmark.mjs
```

The script writes a detailed JSON result to `artifacts/performance-benchmark.json`. Set `DEMOFORGE_BENCHMARK_OUTPUT` to choose another location.

## Recorded run

The following values came from one run on 2026-10-08 at 14:33:37 UTC. They describe this machine and this synthetic workflow; they are not cross-platform performance claims.

| Measurement | Result |
| --- | ---: |
| Host | Windows 10.0.26300, x64 |
| Processor | AMD Ryzen 9 8945HX with Radeon Graphics, 32 logical CPUs |
| Node.js | v24.21.0 |
| Viewport | 1280×720 |
| Workflow | 25 steps, 80 ms pause after browser actions |
| Recorded input duration | 3,220 ms |
| Replay wall clock | 3,727.4 ms |
| Export wall clock | 4,793 ms |
| Capture output | 1,180,575 bytes total; 446,148-byte WebM and 25 screenshots |
| MP4 | 150,534 bytes |
| GIF | 709,753 bytes |
| All export output | 1,498,565 bytes, including guide files and 25 step images |
| Node RSS sampled peak during replay | 158,400,512 bytes (about 151.1 MiB) |
| Node RSS sampled peak during export | 163,213,312 bytes (about 155.6 MiB) |

The benchmark measures each phase with `performance.now()` and samples this Node process's RSS every 20 ms. The RSS values exclude the separately spawned Chromium and FFmpeg processes, so they do not represent total application memory. The sample interval can also miss brief peaks. Replay includes browser startup, workflow execution, screenshots, and video finalization; export includes FFmpeg processing and guide generation.
