class EchoRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.recording = true;
    this.port.onmessage = (e) => {
      if (e.data === "stop") this.recording = false;
    };
  }
  process(inputs, outputs) {
    for (const output of outputs) for (const channel of output) channel.fill(0);
    if (this.recording && inputs[0]?.[0])
      this.port.postMessage(inputs[0][0].slice());
    return this.recording;
  }
}
registerProcessor("echo-recorder", EchoRecorder);
