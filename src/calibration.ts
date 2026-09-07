import { generateSweep } from "./dsp";
export type CaptureResult = {
  rt60: number;
  r2: number;
  snr: number;
  decay: number[];
  impulse: number[];
  device: string;
  processing: boolean;
};
export async function calibrate(
  signal: AbortSignal,
  onProgress: (stage: string, progress: number) => void,
): Promise<CaptureResult> {
  let stream: MediaStream | undefined,
    ctx: AudioContext | undefined,
    source: AudioBufferSourceNode | undefined,
    input: MediaStreamAudioSourceNode | undefined,
    recorder: AudioWorkletNode | undefined,
    worker: Worker | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  const check = () => {
    if (signal.aborted)
      throw new DOMException("Measurement cancelled.", "AbortError");
  };
  const stop = () => {
    try {
      source?.stop();
    } catch {
      /* not running */
    }
    stream?.getTracks().forEach((t) => t.stop());
  };
  signal.addEventListener("abort", stop);
  try {
    onProgress("Waiting for microphone permission", 0);
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
    });
    check();
    const settings = stream.getAudioTracks()[0].getSettings();
    ctx = new AudioContext();
    await ctx.resume();
    check();
    await ctx.audioWorklet.addModule("/recorder-worklet.js");
    check();
    input = ctx.createMediaStreamSource(stream);
    recorder = new AudioWorkletNode(ctx, "echo-recorder");
    const chunks: Float32Array[] = [];
    recorder.port.onmessage = ({ data }) => chunks.push(data);
    const silent = ctx.createGain();
    silent.gain.value = 0;
    input.connect(recorder);
    recorder.connect(silent);
    silent.connect(ctx.destination);
    const sweep = generateSweep(ctx.sampleRate),
      buffer = ctx.createBuffer(1, sweep.length, ctx.sampleRate);
    buffer.copyToChannel(sweep, 0);
    source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(ctx.currentTime + 0.5);
    const started = performance.now();
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        if (timer) clearInterval(timer);
        reject(new DOMException("Measurement cancelled.", "AbortError"));
      };
      signal.addEventListener("abort", abort, { once: true });
      timer = setInterval(() => {
        const elapsed = (performance.now() - started) / 1000;
        onProgress(
          elapsed < 0.5
            ? "Listening to the room"
            : elapsed < 3.5
              ? "Playing a quiet sweep"
              : "Capturing the decay",
          Math.min(0.85, (elapsed / 6) * 0.85),
        );
        if (elapsed >= 6) {
          clearInterval(timer);
          signal.removeEventListener("abort", abort);
          resolve();
        }
      }, 100);
    });
    check();
    recorder.port.postMessage("stop");
    input.disconnect();
    recorder.disconnect();
    stop();
    const recording = new Float32Array(
      chunks.reduce((n, c) => n + c.length, 0),
    );
    let offset = 0;
    chunks.forEach((c) => {
      recording.set(c, offset);
      offset += c.length;
    });
    onProgress("Estimating impulse response and decay", 0.9);
    worker = new Worker(new URL("./acoustics.worker.ts", import.meta.url), {
      type: "module",
    });
    const analysis = await new Promise<
      Omit<CaptureResult, "device" | "processing">
    >((resolve, reject) => {
      const abort = () =>
        reject(new DOMException("Measurement cancelled.", "AbortError"));
      signal.addEventListener("abort", abort, { once: true });
      const timeout = setTimeout(
        () =>
          reject(new Error("Analysis timed out. Try a shorter room capture.")),
        20000,
      );
      worker!.onmessage = ({ data }) => {
        clearTimeout(timeout);
        signal.removeEventListener("abort", abort);
        data.error ? reject(new Error(data.error)) : resolve(data.result);
      };
      worker!.onerror = () => {
        clearTimeout(timeout);
        signal.removeEventListener("abort", abort);
        reject(new Error("The analysis worker could not run."));
      };
      worker!.postMessage(
        {
          type: "calibrate",
          id: 1,
          recording,
          sweep,
          sampleRate: ctx!.sampleRate,
        },
        [recording.buffer, sweep.buffer],
      );
    });
    check();
    onProgress("Capture complete", 1);
    return {
      ...analysis,
      device: stream.getAudioTracks()[0].label || "Default microphone",
      processing: !!(
        settings.echoCancellation ||
        settings.noiseSuppression ||
        settings.autoGainControl
      ),
    };
  } finally {
    signal.removeEventListener("abort", stop);
    if (timer) clearInterval(timer);
    stop();
    input?.disconnect();
    recorder?.disconnect();
    worker?.terminate();
    await ctx?.close();
  }
}
