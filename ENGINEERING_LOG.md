# Engineering log — 7 September 2026

## Milestone 1

Implemented a functional local room instrument with a furnished procedural demo, synchronized editable plan and 3D views, listener-linked walkthrough, browser-generated test audio, live reflection paths, and treatment A/B. The default 40.32 m² room predicts approximately **0.91 s** midband RT60; the example 7.56 m² panel layout predicts approximately **0.68 s**, a **25%** reduction. These are illustrative predictions, not measurements.

## Acoustic approximations

- Coordinates are meters; sound speed is fixed at 343 m/s. One closed, simple floor polygon is extruded to a constant ceiling. Doors/windows are closed patches, not connections to neighboring rooms.
- Image sources produce geometrically valid direct, first-order, and second-order paths, including floor and ceiling. Each path must hit finite surfaces and stay within the room. A six-band amplitude loss uses `sqrt(1 − absorption)` per reflection and `1 / (1 + distance)` spreading. Wall patches integrate at approximately 15 cm resolution; overlapping wall treatments count once.
- Sabine `0.161 V / A` estimates decay at 125–4000 Hz, with a small illustrative air-loss term. Furniture adds approximate effective absorption; floor rugs replace the corresponding floor absorption. This diffuse-field assumption is weak in small, irregular, or highly absorbent rooms.
- Live audio renders up to 40 early arrivals through delay, gain, approximate spectral filtering, and the browser’s generic HRTF. A deterministic stereo noise tail uses six decay envelopes, generated in a worker. The tail is illustrative and limited to three seconds. Updates ramp gains and delays; tail swaps crossfade. The output has conservative gain and a compressor, but device volume still determines sound pressure.
- Calibration plays a 3-second exponential sweep at 0.025 digital peak (about −32 dBFS), after two acknowledgments and microphone permission. An AudioWorklet records without microphone monitoring. A worker estimates a regularized FFT transfer function, aligns its impulse peak, then fits a noise-compensated Schroeder curve from −5 to −25 dB. Clipping, weak signals, poor fits, and inadequate noise separation reject the capture. A successful fit changes one broadband decay absorption factor, not individual material identities or early-path gains.

The [Web Audio spatialization documentation](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Web_audio_spatialization_basics) informs the HRTF implementation; [ConvolverNode documentation](https://developer.mozilla.org/en-US/docs/Web/API/ConvolverNode) informs the diffuse tail. The decay workflow follows the general backward-integration/T20 approach described in [REW’s RT60 documentation](https://www.roomeqwizard.com/betahelp/help/html/graph_rt60.html). These references do not validate this application’s predictions.

## Validation and corrections

- Ten unit tests pass: analytical shoebox distances and six first reflections; movement and second reflections; treatment absorption and unchanged original state; overlapping treatment accounting; concave-room visibility; malformed backups; deterministic stereo tails; FFT round-trip; recovery of an exponential decay; bounded sweep, silence/clipping rejection, and end-to-end synthetic sweep deconvolution.
- Browser verification exercises actual canvas rendering, source drag, changing acoustic paths, running Web Audio output, and offline rendered stereo energy that changes with listener orientation. It also covers walkthrough controls, material edits, undo, export, IndexedDB reload, scaled floor-plan tracing, explicit microphone consent/cancellation, and a 390 px mobile layout.
- Inspected desktop, treated, plan, walkthrough, calibration, and mobile screenshots. Corrected the initial listening orientation and walkthrough field of view, camera fitting for narrow screens, path contrast, and always-accessible treatment/calibration controls.
- Replaced approximate whole-path tube tessellation with exact straight reflection segments. Batched static architecture by material and selectable object to reduce draw calls while preserving object selection. Expensive simulation, tail synthesis, and calibration FFTs run in workers.
- Production/offline and extended microphone/debug checks are recorded in the final verification section below.

## Known limits and next improvements

No room modes, diffraction, furniture occlusion, scattering, transmission, or personalized HRTFs. Furniture can overlap and its effective absorption is heuristic. Material coefficients are illustrative, not manufacturer-certified data. Photographs are references only. The rectangle suggestion is a dark-pixel envelope, not architectural recognition; users must trace/review openings and furniture. The model is best suited to ordinary single rooms.

Calibration has been validated against synthetic data and browser permission/capture plumbing, **not an actual speaker–room–microphone measurement**. Device frequency response, clock drift, background noise, and browser processing can bias results. A displayed fit is not a calibrated SPL or certified RT60 measurement.

Best next improvements: validate against measured reference rooms and known microphones; add robust noise-floor/truncation diagnostics and multi-position octave-band calibration; model furniture occlusion and low-frequency modes; add material thickness/mounting variants; improve tracing with constrained local image segmentation and confidence bounds. Split the main workbench component into smaller editor panels as the tool grows.

## Final verification

`npm test`: **10 passed**. `npm run build`: strict TypeScript and production build passed. `npm run test:e2e`: **9 passed**, including a production reload with the browser network disabled, followed by treatment calculation and running spatial audio. The production page made **zero external requests**. Microphone cancellation was checked against actual captured track states (`ended`); denial produced an actionable message and no room mutation.

Headless Chrome on this machine reported **176 draw calls**, **20,362 triangles**, and **173 GPU geometries**, with the geometry count unchanged after 40 source updates. Observed rendering was 31–42 fps during these automated runs; the initial acoustic worker calculation took about 7 ms. These are local observations, not cross-device guarantees. Rotating the listener changed the offline rendered early-response stereo energy from L/R **0.02535 / 0.03222** to **0.03055 / 0.01637**. Live playback also produced nonzero output RMS with its diffuse tail ready.

Final screenshots are in `artifacts/`, including desktop, treated, walkthrough entry, traced plan, calibration, mobile, and offline production. Development remains available on **5173**; the production preview is on **4173**.
