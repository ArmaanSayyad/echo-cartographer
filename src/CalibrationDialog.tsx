import { useEffect, useRef, useState } from "react";
import { AudioLines, Check, Mic, Square, Volume1 } from "lucide-react";
import Modal from "./Modal";
import { MeasuredChart } from "./Charts";
import { calibrate } from "./calibration";
import type { CaptureResult } from "./calibration";
import type { Calibration } from "./model";
export default function CalibrationDialog({
  onClose,
  onApply,
  predicted,
}: {
  onClose: () => void;
  onApply: (value: Calibration) => void;
  predicted: number;
}) {
  const [ready, setReady] = useState(false),
    [quiet, setQuiet] = useState(false),
    [running, setRunning] = useState(false),
    [progress, setProgress] = useState(0),
    [stage, setStage] = useState(""),
    [error, setError] = useState(""),
    [capture, setCapture] = useState<CaptureResult>();
  const abort = useRef<AbortController | null>(null),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      abort.current?.abort();
    };
  }, []);
  const start = async () => {
    abort.current = new AbortController();
    setRunning(true);
    setError("");
    setCapture(undefined);
    try {
      const value = await calibrate(abort.current.signal, (s, p) => {
        if (mounted.current) {
          setStage(s);
          setProgress(p);
        }
      });
      if (mounted.current) setCapture(value);
    } catch (e) {
      if (mounted.current)
        setError(
          (e as Error).name === "NotAllowedError"
            ? "Microphone access was not granted. You can continue using the simulated room, or allow access in browser settings and retry."
            : (e as Error).message,
        );
    } finally {
      if (mounted.current) setRunning(false);
    }
  };
  return (
    <Modal
      title="Listen to the real room."
      eyebrow="OPTIONAL CALIBRATION · EXPERIMENTAL"
      onClose={() => {
        abort.current?.abort();
        onClose();
      }}
    >
      <div className="calibration-body">
        {!capture ? (
          <>
            <div className={`calibration-orb ${running ? "recording" : ""}`}>
              <AudioLines size={42} strokeWidth={1} />
            </div>
            <p className="modal-intro">
              A short, quiet frequency sweep helps estimate your room’s decay.
              The recording is processed on this device and discarded after
              analysis.
            </p>
            <div className="calibration-specs">
              <span>
                <Volume1 size={16} />
                100 Hz–12 kHz
              </span>
              <span>3 second sweep</span>
              <span>−32 dBFS peak</span>
            </div>
            <p className="hint">
              Browser volume cannot establish a safe sound pressure level. Start
              with your speaker volume low. Keep the microphone at the modeled
              listener position and the speaker at the source position. This
              fits the original room (A), excluding proposed treatments.
            </p>
            {!running ? (
              <div className="consent-options">
                <label>
                  <input
                    type="checkbox"
                    checked={ready}
                    onChange={(e) => setReady(e.target.checked)}
                  />
                  I’m using a room speaker at low volume, with headphones
                  removed.
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={quiet}
                    onChange={(e) => setQuiet(e.target.checked)}
                  />
                  The room is quiet. I consent to microphone capture for this
                  measurement.
                </label>
              </div>
            ) : (
              <div className="calibration-progress">
                <div>
                  <span>{stage}</span>
                  <span>{Math.round(progress * 100)}%</span>
                </div>
                <progress value={progress} max="1" />
                <p className="hint">
                  Remain still. The microphone is never routed to your speakers.
                </p>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="capture-label">
              <span className="status-dot" />
              MEASURED · BROWSER CAPTURE
            </div>
            <div className="capture-result">
              <strong>
                {capture.rt60.toFixed(2)}
                <small>s</small>
              </strong>
              <span>
                Approximate broadband RT60
                <br />
                Extrapolated from a T20 fit
              </span>
            </div>
            <MeasuredChart decay={capture.decay} impulse={capture.impulse} />
            <div className="calibration-specs">
              <span>Fit R² {capture.r2.toFixed(3)}</span>
              <span>Peak / tail noise {capture.snr.toFixed(0)} dB</span>
            </div>
            <p className="hint">
              {capture.device}.{" "}
              {capture.processing
                ? "Your browser kept microphone processing enabled; it may bias the measurement. "
                : ""}
              This captures the combined speaker, microphone, and room response.
              Applying it adjusts one overall decay absorption factor, not
              individual material measurements.
            </p>
            <div className="fit-preview">
              <span>Simulated midband decay</span>
              <strong>
                {predicted.toFixed(2)} s <span>→</span> ~
                {capture.rt60.toFixed(2)} s
              </strong>
            </div>
          </>
        )}
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
      </div>
      <footer className="modal-footer">
        <span>Exploration, not acoustic certification.</span>
        {running ? (
          <button
            className="danger-button"
            onClick={() => abort.current?.abort()}
          >
            <Square size={14} /> Stop capture
          </button>
        ) : capture ? (
          <button
            className="primary-button"
            onClick={() =>
              onApply({
                ...capture,
                scale: Math.max(0.2, Math.min(4, predicted / capture.rt60)),
                measuredAt: new Date().toISOString(),
                applied: true,
              })
            }
          >
            <Check size={16} /> Apply approximate fit
          </button>
        ) : (
          <button
            className="primary-button"
            disabled={!ready || !quiet || !navigator.mediaDevices?.getUserMedia}
            onClick={() => void start()}
          >
            <Mic size={16} /> Allow microphone & start
          </button>
        )}
      </footer>
    </Modal>
  );
}
