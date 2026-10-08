# FFmpeg editing effects evidence

Version-one editing effects are built by `buildEffects(project, run, staging)` in `src/media/effects.ts`. It returns video filters plus FFmpeg audio arguments. The exporter must run FFmpeg with its working directory set to the export staging directory, apply full-frame privacy masks before the returned filters, then apply crop and trim. Cursor and annotation subtitles refer only to fixed staging-relative files (`cursor.ass` and `annotations.ass`); user text and paths are never inserted into FFmpeg filter syntax.

Zooms use one `zoompan` filter with an output size equal to the project viewport. Zoom ranges are expressed on the original recording timeline and sampled at 25 fps. This matches the installed Playwright recorder default: `playwright-core` sets `kDefaultFps = 25` and passes `options.fps ?? kDefaultFps` to its FFmpeg recorder in `node_modules/playwright-core/lib/coreBundle.js`. The requested focus stays at the viewport center when bounds permit; the crop clamps at the input edges. Overlapping zoom ranges fail with an error. The filter supports at most 64 intervals and rejects intervals shorter than one output frame, rather than omitting them silently.

Cursor highlighting uses the actual `run.cursor` samples. Samples are sorted and quantized to the 25 fps video frames, then the highlight moves between sampled positions and stays at the last position through the end of the run. Samples outside the project viewport are not drawn. More than 20,000 cursor samples is rejected with an explicit error. Annotation text is rendered by FFmpeg's `subtitles`/libass filter. Text is escaped for ASS braces and backslashes, line breaks become ASS line breaks, and control characters are removed. Caption times are limited to the run duration; intervals shorter than ASS's 10 ms timestamp resolution are rejected. The style requests Arial, allowing libass to use its installed font fallback. DemoForge does not fetch or bundle fonts.

Audio files must be absolute paths to regular local files. The input path is passed as a separate `-i` argument. The audio filter places the source at `startMs` on the original recording timeline, trims against the selected video trim range, resets timestamps, applies `volume`, and pads with silence. Returned arguments map the original video and the added audio input, encode audio as AAC, and set the output duration to the trimmed video duration. The caller must omit `-an` when these arguments are present. `apad` plus the output duration prevents a short audio file from shortening the video.

## Verification

`tests/media/effects.test.ts` first failed against an empty `buildEffects` stub: zoom had no pixel effect, captions and cursor produced no visible pixels, no audio stream was emitted, and overlapping ranges were accepted. After implementation, the same suite encoded and decoded synthetic media with the configured local FFmpeg binary:

```powershell
$env:DEMOFORGE_FFMPEG = 'C:\Users\mamid\AppData\Local\Programs\Python\Python312\Lib\site-packages\imageio_ffmpeg\binaries\ffmpeg-win-x86_64-v7.1.exe'
& .\node_modules\.bin\vitest.cmd run tests/media/effects.test.ts
npm run typecheck
```

The six passing tests use a 160×120, 25 fps red video with a blue region for focus checks, and inspect decoded RGB pixels. They confirm that the blue region moves to the configured focus during the zoom while the frame remains 160×120; timed hostile-looking caption text renders without breaking the filter graph; cursor highlights follow the two recorded points; and a 400 ms tone placed at 600 ms, trimmed to 200–1,800 ms, and padded produces about 1.6 seconds of audio with silence before and after the tone. Additional cases verify explicit rejection of overlapping zooms and unsupported zoom/cursor densities. No FFmpeg binary or font is included in the repository.
