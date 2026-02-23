// public/audio-processor.js
class PCMProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.targetRate = 16000;
    // Get the native hardware rate from React (defaults to 48k just in case)
    this.inputRate = options.processorOptions?.sampleRate || 48000; 
    this.ratio = this.inputRate / this.targetRate;
    
    this.bufferSize = 4096;
    this.buffer = new Int16Array(this.bufferSize);
    this.bufferIndex = 0;
    this.maxAmplitude = 0;
    this.remainder = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (input && input.length > 0) {
      const channelData = input[0];
      
      let i = this.remainder;
      while (i < channelData.length) {
        // Mathematical downsampling
        let val = channelData[Math.floor(i)];
        if (Math.abs(val) > this.maxAmplitude) this.maxAmplitude = Math.abs(val);
        
        // 10.0x Gain Boost
        let s = Math.max(-1, Math.min(1, val * 10.0));
        this.buffer[this.bufferIndex] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        this.bufferIndex++;

        // Send exactly 4096 frames of pure 16kHz audio to React
        if (this.bufferIndex >= this.bufferSize) {
          this.port.postMessage({ 
            pcmData: new Int16Array(this.buffer), 
            maxAmplitude: this.maxAmplitude 
          });
          this.bufferIndex = 0;
          this.maxAmplitude = 0; 
        }
        
        i += this.ratio;
      }
      this.remainder = i - channelData.length;
    }
    return true; 
  }
}

registerProcessor('pcm-processor', PCMProcessor);