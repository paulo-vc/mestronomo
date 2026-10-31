// Toca no fone do mestre os quadros PCM (s16, 48 kHz, estéreo) que o mixer manda a cada 20 ms.
// Um buffer circular absorve o jitter do IPC: começa a tocar com 2 quadros guardados e,
// se acumular mais de 10 (200 ms), descarta o excesso para o atraso não crescer.

const FRAME_VALUES = 960 * 2;
const PREBUFFER = FRAME_VALUES * 2;
const MAX_BUFFERED = FRAME_VALUES * 10;

class MonitorProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(48000 * 2);
    this.readPos = 0;
    this.writePos = 0;
    this.count = 0;
    this.playing = false;
    this.port.onmessage = (event) => this.push(new Int16Array(event.data));
  }

  push(pcm) {
    const len = this.buf.length;
    for (let i = 0; i < pcm.length; i++) {
      this.buf[this.writePos] = pcm[i] / 32768;
      this.writePos = (this.writePos + 1) % len;
    }
    this.count += pcm.length;
    if (this.count > MAX_BUFFERED) {
      const drop = this.count - PREBUFFER;
      this.readPos = (this.readPos + drop) % len;
      this.count -= drop;
    }
  }

  process(_inputs, outputs) {
    const [left, right] = outputs[0];
    if (!this.playing && this.count < PREBUFFER) return true;
    this.playing = true;
    const len = this.buf.length;
    for (let i = 0; i < left.length; i++) {
      if (this.count < 2) {
        // Acabou o que tocar: silêncio e volta a esperar o pré-buffer.
        left[i] = right[i] = 0;
        this.playing = false;
        continue;
      }
      left[i] = this.buf[this.readPos];
      right[i] = this.buf[(this.readPos + 1) % len];
      this.readPos = (this.readPos + 2) % len;
      this.count -= 2;
    }
    return true;
  }
}

registerProcessor('monitor', MonitorProcessor);
