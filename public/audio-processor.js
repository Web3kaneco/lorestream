// public/audio-processor.js
class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 4096; 
    this.buffer = new Int16Array(this.bufferSize);
    this.bufferIndex = 0;
    this.maxAmplitude = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    
    // The browser will automatically downmix ANY mic into this single channel
    const channelData = input[0]; 
    
    for (let i = 0; i < channelData.length; i++) {
      let val = channelData[i];
      if (Math.abs(val) > this.maxAmplitude) this.maxAmplitude = Math.abs(val);
      
      // NO MULTIPLIERS! The compressor already leveled the audio perfectly.
      let s = Math.max(-1, Math.min(1, val));
      this.buffer[this.bufferIndex] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      this.bufferIndex++;

      if (this.bufferIndex >= this.bufferSize) {
        this.port.postMessage({ 
          pcmData: new Int16Array(this.buffer), 
          maxAmplitude: this.maxAmplitude 
        });
        this.bufferIndex = 0;
        this.maxAmplitude = 0; 
      }
    }
    return true; 
  }
}

registerProcessor('pcm-processor', PCMProcessor);