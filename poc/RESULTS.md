# Phase 0 PoC — Results

Status: week 2, day 9 (measurements in progress). Decision rules: PoC plan, "Isporuke i odluka".

## Devices

| Platform | Device | OS | Build | Note |
|---|---|---|---|---|
| Android | _model_ | _version_ | release, debug-signed | Newer than the planned 3–4-year-old mid-range device: Android numbers are optimistic. |
| iOS | iPad (8th gen), A12 | iPadOS _17.x_ | Release | Stands in for an older iPhone (A12 = iPhone XS). Xcode 15.4. |

## Method

All times use the native clock only. The bench panel at the bottom of each host runs M1–M3; results are shown there and logged (`MantikoraBench` in Logcat, `dev.mantikora.poc/bench` in Console).

- **M1 tap → frame:** 200 taps through the same path as the button (`sendEvent("tap")`), 50 ms apart. Measured from sending the event to the first frame callback (`Choreographer` / `CADisplayLink`) after the batch with `evt ≥ seq` is applied. It excludes touch input dispatch, which is the same for any native app.
- **M2 batch apply:** main-thread time of `NodeStore.apply` for every real batch with ≤ 50 ops, plus 30 runs of a synthetic 501-op batch (a column with 125 texts, detached, destroyed after each run).
- **M3 stress:** JS increments the counter 60×/s for 30 s and busy-waits 100 ms every second. Native counts frame intervals longer than 1.5× the median interval.
- **M4 input:** manual. Type 200 characters fast with autocorrect on; count lost or duplicated characters and cursor jumps; after blur the field and "Hello …" must match.
- **M5 size:** non-blank, non-comment lines of host + mirror code (bench excluded); JS bundle from `ng build`.

## Results

| Metric | Target | Android | iOS (iPad 8) |
|---|---|---|---|
| M1 tap → frame | p50 ≤ 16 ms, p95 ≤ 33 ms | | |
| M2 typical batch | p95 ≤ 4 ms | | |
| M2 501-op batch | record | | |
| M3 janky frames | no continuous loss (K3: > 5%) | | |
| M4 input errors | 0 | | |
| M5 native lines | ≤ 1,500 per platform | 425 | 483 |
| M5 JS bundle | record | 107 KB raw, 35.8 KB gzip (shared) | same bundle |
| M6 JSC bootstrap | week 3 | — | |

JS renderer: 381 lines. Native bench tooling (not counted): 158 lines Android, 157 lines iOS.

## Kill criteria

| # | Criterion | Result |
|---|---|---|
| K1 | M1 p95 > 50 ms on any device in the WebView host | |
| K2 | Typical batch > 4 ms p95 on main thread, or a lost frame on the older iOS device | |
| K3 | Native UI continuously loses frames during M3 (> 5%) | |
| K4 | Text field loses/duplicates characters or the cursor jumps | |
| K5 | Renderer in the WebView host needs `ɵ` APIs | Pass: no `ɵ` imports (checked in `src/`) |
| K6 | Angular in JSC needs patched packages or `ɵ` outside one adapter file | week 3 |
| K7 | Native code for 4 components + host > 1,500 lines per platform | Pass: 425 / 483 |

## Surprising positives

- [x] Under 800 lines of native code per platform (425 / 483)
- [x] Zero `ɵ` imports in the WebView host
- [ ] M1 p95 ≤ 16 ms on both devices
- [ ] Same bundle, byte for byte, in WebView and JSC hosts (week 3)
- [ ] Dynamic SwiftUI tree without `AnyView` and without a noticeable slowdown (implemented; waiting on M1/M2 on iPad)
- [ ] No lost frame during M3 while JS blocks

## Decision

_Pending day 10._
