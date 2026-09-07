/// <reference lib="webworker" />
import { simulate, makeTail } from "./acoustics";
import { analyzeSweep } from "./dsp";
self.onmessage = (event: MessageEvent) => {
  const { id, type } = event.data;
  try {
    if (type === "simulate") {
      const result = simulate(
        event.data.room,
        event.data.treated,
        event.data.order,
      );
      self.postMessage({ id, type, result });
    } else if (type === "tail") {
      const channels = makeTail(event.data.rt60, event.data.sampleRate);
      self.postMessage(
        { id, type, channels },
        { transfer: channels.map((c) => c.buffer) },
      );
    } else if (type === "calibrate") {
      const result = analyzeSweep(
        event.data.recording,
        event.data.sweep,
        event.data.sampleRate,
      );
      self.postMessage({ id, type, result });
    }
  } catch (error) {
    self.postMessage({
      id,
      type,
      error: error instanceof Error ? error.message : "Calculation failed.",
    });
  }
};
