// public/audio-processor.js
// AudioWorklet processor: captures mic audio at AudioContext rate (24kHz),
// downsamples to 16kHz PCM for Gemini Live API input.

class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // Output buffer at 16kHz — Gemini expects 16kHz PCM input
    this.outputBufferSize = 4096;
    this.outputBuffer = new Int16Array(this.outputBufferSize);
    this.outputIndex = 0;
    this.maxAmplitude = 0;

    // Resampling state: 24kHz context → 16kHz output (ratio = 2/3)
    // We accumulate fractional sample positions for smooth interpolation
    this.resamplePos = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;

    // The browser downmixes any mic into this single channel
    const channelData = input[0];
    if (!channelData || channelData.length === 0) return true;

    // Context runs at 24kHz (sampleRate), we need 16kHz output
    // Ratio: 16000 / 24000 = 2/3
    const inputRate = sampleRate; // AudioWorklet global: actual context sample rate
    const outputRate = 16000;
    const ratio = outputRate / inputRate; // 0.6667 for 24kHz→16kHz

    // If rates match (no resampling needed), use original fast path
    if (Math.abs(inputRate - outputRate) < 100) {
      for (let i = 0; i < channelData.length; i++) {
        let val = channelData[i];
        if (Math.abs(val) > this.maxAmplitude) this.maxAmplitude = Math.abs(val);

        let s = Math.max(-1, Math.min(1, val));
        this.outputBuffer[this.outputIndex] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        this.outputIndex++;

        if (this.outputIndex >= this.outputBufferSize) {
          this.port.postMessage({
            pcmData: new Int16Array(this.outputBuffer),
            maxAmplitude: this.maxAmplitude
          });
          this.outputIndex = 0;
          this.maxAmplitude = 0;
        }
      }
      return true;
    }

    // Linear interpolation downsampling: 24kHz → 16kHz
    const inputLen = channelData.length;

    while (this.resamplePos < inputLen) {
      const srcFloor = Math.floor(this.resamplePos);
      const frac = this.resamplePos - srcFloor;
      const s0 = channelData[Math.min(srcFloor, inputLen - 1)];
      const s1 = channelData[Math.min(srcFloor + 1, inputLen - 1)];
      const val = s0 + frac * (s1 - s0);

      if (Math.abs(val) > this.maxAmplitude) this.maxAmplitude = Math.abs(val);

      let s = Math.max(-1, Math.min(1, val));
      this.outputBuffer[this.outputIndex] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      this.outputIndex++;

      if (this.outputIndex >= this.outputBufferSize) {
        this.port.postMessage({
          pcmData: new Int16Array(this.outputBuffer),
          maxAmplitude: this.maxAmplitude
        });
        this.outputIndex = 0;
        this.maxAmplitude = 0;
      }

      // Advance by 1/ratio input samples per output sample
      // For 24k→16k: advance by 1.5 input samples per output sample
      this.resamplePos += 1 / ratio;
    }

    // Carry over the fractional position for the next process() call
    this.resamplePos -= inputLen;

    return true;
  }
}

registerProcessor('pcm-processor', PCMProcessor);
