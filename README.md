# Echo Cartographer

A local acoustic sketchbook: trace a real room, explore it in 2D and 3D, move a sound source and listener, and compare acoustic treatments through headphones.

## Run locally

Use Node **22.12+** (Node 24 recommended).

```sh
cd /Users/armaan/Documents/echo-cartographer
npm ci
npm run dev -- --port 5173
```

Open **http://127.0.0.1:5173**. The furnished demo is immediately available. No API keys, accounts, backend, or remote assets are needed.

```sh
npm run build
npm run preview -- --port 4173
```

The production preview at http://127.0.0.1:4173 installs an offline cache. After its first successful load and service worker activation, the application can reload and calculate acoustics without a network connection. The development server does not install a service worker. Keep a stable port: browser storage is scoped to the origin, including its port.

## Try the first milestone

1. Put on headphones and press **Play** in the bottom audio dock. Start at a comfortable low device volume.
2. Drag the speaker or listener in the **plan overview**, full **2D plan**, or 3D view. Arrival times, paths, direction, and distance update together. Select either marker to enter coordinates or adjust listening orientation.
3. Enter **Walkthrough**. Use WASD to move, drag to look, or use the on-screen controls. Arrow keys turn; Escape returns to orbit.
4. Click **Add a treatment**. The selected wall receives a panel; if no wall is selected, wall 2 is used. Adjust the wall, width, height, offset, and material in Selection.
5. Switch **A Original / B Treated** to compare both audio and predicted decay. A excludes added treatments; all other room edits apply to both states. Playback does not restart when switching.

Use **New room** to load a PNG, JPEG, or WebP floor plan. Mark two endpoints of one known distance, enter the distance and ceiling height, then click the interior corners in order. A bounding-rectangle suggestion is available and explicitly marked as low confidence. Review its corners. Add doors, windows, furniture, and treatments with the **+** toolbar or scene controls. Uploaded photographs are local visual references; the application does not claim automatic material recognition.

## Privacy and persistence

The `/` workspace autosaves the room, compressed reference images, material choices, and optional calibration summary to IndexedDB. No network requests carry personal data. Calibration recordings remain in memory and are discarded after analysis; only a compact impulse envelope, decay curve, fit statistics, and device label are retained. Closing/canceling the dialog stops the microphone tracks.

Export a `.echo.json` backup using **Room actions → Export room backup**. Restore it with **Open room backup**. Import validation rejects invalid geometry and external image references. Undo/redo retains up to 40 recent editing snapshots during the session. Browser data can be cleared or evicted, so export important rooms.

## Inspection and verification

| Route                      | Behavior                                            |
| -------------------------- | --------------------------------------------------- |
| `/`                        | Your persisted workspace, starting with the demo    |
| `/demo?capture=1`          | Deterministic furnished room; frozen path particles |
| `/scene/shoebox?capture=1` | Empty 6 × 4 × 2.8 m reference box                   |
| `/scene/treated?capture=1` | Furnished room with a known panel layout            |
| `/inspect`                 | Demo with the acoustic debug panel open             |

Non-root inspection routes do **not** read or overwrite the saved workspace. Export remains available.

`window.__ECHO__.getState()` exposes the room, valid reflection paths, six-band absorption and decay, comparison state, renderer counters, and live audio RMS. Debug controls include `moveSource`, `moveListener`, `setComparison`, `loadScene`, and `renderProbe` (an actual offline Web Audio stereo energy probe). **Engine v0.1** opens the visible inspector and JSON export.

```sh
npm test                 # analytical geometry, acoustic and DSP checks
npm run build            # strict TypeScript + production build + offline cache
npm run test:e2e         # Chrome interactions, audio, persistence, import, mic, offline
```

The browser suite uses installed Google Chrome with synthetic microphone input. It starts/reuses local servers on 5173 and 4173; run the build first. Screenshots are written to `artifacts/`, with failure traces in `test-results/`.

## Scope

TypeScript, React, Three.js, Web Audio, AudioWorklet, web workers, IndexedDB, and a Vite/Workbox offline build. Geometry, sound synthesis, and visual assets are original procedural work. See [ATTRIBUTION.md](./ATTRIBUTION.md) and the bundled [licenses](./public/licenses.txt).

Predictions are approximate. This is not professional acoustic certification. See [ENGINEERING_LOG.md](./ENGINEERING_LOG.md) for the model, validation evidence, limitations, and next improvements.
