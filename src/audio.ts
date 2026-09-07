import type { AcousticResult, SoundPath } from "./acoustics";
import type { Room, Vec3 } from "./model";
type Voice = {
  delay: DelayNode;
  filter: BiquadFilterNode;
  gain: GainNode;
  panner: PannerNode;
};
export class SpatialAudio {
  context?: AudioContext;
  private input?: AudioBufferSourceNode;
  private bus?: GainNode;
  private master?: GainNode;
  private analyser?: AnalyserNode;
  private voices = new Map<string, Voice>();
  private tail?: { convolver: ConvolverNode; gain: GainNode };
  private tailWorker?: Worker;
  private tailId = 0;
  private tailKey = "";
  playing = false;
  volume = 0.45;
  signal: "percussion" | "noise" = "percussion";
  private last?: { room: Room; result: AcousticResult };
  async start() {
    if (!this.context) {
      this.context = new AudioContext();
      this.bus = this.context.createGain();
      this.master = this.context.createGain();
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 512;
      const limiter = this.context.createDynamicsCompressor();
      limiter.threshold.value = -12;
      limiter.knee.value = 6;
      limiter.ratio.value = 16;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.15;
      this.master.gain.value = 0;
      this.master.connect(limiter);
      limiter.connect(this.analyser);
      this.analyser.connect(this.context.destination);
      this.tailWorker = new Worker(
        new URL("./acoustics.worker.ts", import.meta.url),
        { type: "module" },
      );
      this.tailWorker.onmessage = ({ data }) => {
        if (
          data.id !== this.tailId ||
          !this.context ||
          !this.bus ||
          !this.master ||
          data.error
        )
          return;
        const buffer = this.context.createBuffer(
          2,
          data.channels[0].length,
          this.context.sampleRate,
        );
        buffer.copyToChannel(data.channels[0], 0);
        buffer.copyToChannel(data.channels[1], 1);
        const convolver = this.context.createConvolver(),
          gain = this.context.createGain();
        convolver.normalize = false;
        convolver.buffer = buffer;
        gain.gain.value = 0;
        this.bus.connect(convolver);
        convolver.connect(gain);
        gain.connect(this.master);
        gain.gain.setTargetAtTime(0.75, this.context.currentTime, 0.05);
        const previous = this.tail;
        if (previous) {
          previous.gain.gain.setTargetAtTime(0, this.context.currentTime, 0.05);
          setTimeout(() => {
            try {
              this.bus?.disconnect(previous.convolver);
            } catch {
              /* already disposed */
            }
            previous.convolver.disconnect();
            previous.gain.disconnect();
          }, 350);
        }
        this.tail = { convolver, gain };
      };
    }
    await this.context.resume();
    this.playing = true;
    this.createSignal();
    this.master!.gain.setTargetAtTime(
      this.volume * 0.32,
      this.context.currentTime,
      0.04,
    );
    if (this.last) this.update(this.last.room, this.last.result);
  }
  private createSignal() {
    if (!this.context || !this.bus) return;
    this.input?.stop();
    this.input?.disconnect();
    const sr = this.context.sampleRate,
      data = new Float32Array(sr * 8);
    let seed = 891;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return (seed / 4294967296) * 2 - 1;
    };
    if (this.signal === "noise") {
      let low = 0;
      for (let i = 0; i < data.length; i++) {
        low = 0.96 * low + 0.04 * random();
        data[i] = low * 1.6 * Math.min(1, i / 2000, (data.length - i) / 2000);
      }
    } else {
      const notes = [
        220, 329.63, 440, 293.66, 261.63, 392, 329.63, 196, 220, 440, 392,
        293.66,
      ];
      notes.forEach((note, k) => {
        const start = Math.floor(k * 0.625 * sr);
        for (let j = 0; j < sr * 0.8 && start + j < data.length; j++) {
          const t = j / sr,
            attack = Math.min(1, t / 0.003),
            decay = Math.exp(-t * 7);
          const tone =
            Math.sin(2 * Math.PI * note * t) * 0.55 +
            Math.sin(2 * Math.PI * note * 2.76 * t) * 0.18 * Math.exp(-t * 10) +
            Math.sin(2 * Math.PI * note * 5.4 * t) * 0.12 * Math.exp(-t * 20);
          data[start + j] +=
            attack * (tone * decay + random() * 0.28 * Math.exp(-t * 110));
        }
      });
    }
    const buffer = this.context.createBuffer(1, data.length, sr);
    buffer.copyToChannel(data, 0);
    this.input = this.context.createBufferSource();
    this.input.buffer = buffer;
    this.input.loop = true;
    this.input.connect(this.bus);
    this.input.start();
  }
  setSignal(signal: "percussion" | "noise") {
    this.signal = signal;
    if (this.playing) this.createSignal();
  }
  stop() {
    this.playing = false;
    if (this.context && this.master)
      this.master.gain.setTargetAtTime(0, this.context.currentTime, 0.025);
    const input = this.input;
    this.input = undefined;
    if (input) {
      input.stop((this.context?.currentTime ?? 0) + 0.15);
      setTimeout(() => input.disconnect(), 250);
    }
  }
  setVolume(volume: number) {
    this.volume = volume;
    if (this.context && this.master && this.playing)
      this.master.gain.setTargetAtTime(
        volume * 0.32,
        this.context.currentTime,
        0.025,
      );
  }
  private position(panner: PannerNode, p: Vec3) {
    const t = this.context!.currentTime;
    panner.positionX.setTargetAtTime(p.x, t, 0.025);
    panner.positionY.setTargetAtTime(p.y, t, 0.025);
    panner.positionZ.setTargetAtTime(p.z, t, 0.025);
  }
  private voice(path: SoundPath) {
    let voice = this.voices.get(path.id);
    if (!voice) {
      const ctx = this.context!,
        delay = ctx.createDelay(2),
        filter = ctx.createBiquadFilter(),
        gain = ctx.createGain(),
        panner = ctx.createPanner();
      panner.panningModel = "HRTF";
      panner.rolloffFactor = 0;
      filter.type = "lowpass";
      gain.gain.value = 0;
      this.bus!.connect(delay);
      delay.connect(filter);
      filter.connect(gain);
      gain.connect(panner);
      panner.connect(this.master!);
      voice = { delay, filter, gain, panner };
      this.voices.set(path.id, voice);
    }
    const t = this.context!.currentTime;
    voice.delay.delayTime.setTargetAtTime(Math.min(1.99, path.delay), t, 0.025);
    voice.gain.gain.setTargetAtTime(path.gains[2], t, 0.035);
    voice.filter.frequency.setTargetAtTime(
      Math.max(
        600,
        Math.min(
          18000,
          (14000 * path.gains[5]) / Math.max(0.0001, path.gains[1]),
        ),
      ),
      t,
      0.04,
    );
    this.position(voice.panner, path.points[path.points.length - 2]);
  }
  update(room: Room, result: AcousticResult) {
    this.last = { room, result };
    if (!this.context || !this.bus) return;
    const t = this.context.currentTime,
      listener = this.context.listener;
    listener.positionX.setTargetAtTime(room.listener.x, t, 0.025);
    listener.positionY.setTargetAtTime(room.listener.y, t, 0.025);
    listener.positionZ.setTargetAtTime(room.listener.z, t, 0.025);
    listener.forwardX.setTargetAtTime(Math.sin(room.yaw), t, 0.025);
    listener.forwardY.setTargetAtTime(0, t, 0.025);
    listener.forwardZ.setTargetAtTime(-Math.cos(room.yaw), t, 0.025);
    listener.upX.value = 0;
    listener.upY.value = 1;
    listener.upZ.value = 0;
    const audible = result.paths.slice(0, 40),
      ids = new Set(audible.map((p) => p.id));
    for (const [id, voice] of this.voices)
      if (!ids.has(id)) {
        voice.gain.gain.setTargetAtTime(0, t, 0.025);
        this.voices.delete(id);
        setTimeout(() => {
          try {
            this.bus?.disconnect(voice.delay);
          } catch {
            /* already disposed */
          }
          voice.delay.disconnect();
          voice.filter.disconnect();
          voice.gain.disconnect();
          voice.panner.disconnect();
        }, 250);
      }
    audible.forEach((p) => this.voice(p));
    const key = result.rt60.map((n) => n.toFixed(3)).join(",");
    if (key !== this.tailKey) {
      this.tailKey = key;
      this.tailWorker?.postMessage({
        type: "tail",
        id: ++this.tailId,
        rt60: result.rt60,
        sampleRate: this.context.sampleRate,
      });
    }
  }
  debug() {
    const data = new Float32Array(256);
    this.analyser?.getFloatTimeDomainData(data);
    return {
      state: this.context?.state ?? "not-started",
      playing: this.playing,
      voices: this.voices.size,
      sampleRate: this.context?.sampleRate ?? 0,
      rms: Math.sqrt(data.reduce((n, v) => n + v * v, 0) / data.length),
      tailReady: !!this.tail,
    };
  }
  dispose() {
    this.stop();
    this.tailWorker?.terminate();
    void this.context?.close();
  }
}
