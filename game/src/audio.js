// audio.js — tiny synthesised sound effects via WebAudio. No audio files:
// every sound is an oscillator/noise burst built at runtime, so the game
// stays fully offline with zero assets to fetch.

export function createAudio() {
  let ctx = null;
  function ensure() {
    if (!ctx) {
      try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { ctx = null; }
    }
    if (ctx && ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function blip(freq, dur, type, gain, slideTo) {
    const ac = ensure();
    if (!ac) return;
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ac.currentTime);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, ac.currentTime + dur);
    g.gain.setValueAtTime(gain, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
    osc.connect(g).connect(ac.destination);
    osc.start();
    osc.stop(ac.currentTime + dur);
  }
  function noise(dur, gain, low) {
    const ac = ensure();
    if (!ac) return;
    const len = Math.floor(ac.sampleRate * dur);
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ac.createBufferSource();
    src.buffer = buf;
    const filter = ac.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = low;
    const g = ac.createGain();
    g.gain.value = gain;
    src.connect(filter).connect(g).connect(ac.destination);
    src.start();
  }
  return {
    unlock() { ensure(); },
    shot() { noise(0.09, 0.25, 2400); blip(190, 0.07, 'square', 0.08, 70); },
    empty() { blip(1400, 0.05, 'square', 0.05); },
    hit() { blip(1150, 0.06, 'sine', 0.12); },
    hurt() { noise(0.15, 0.2, 700); },
    reload() { blip(500, 0.09, 'square', 0.06, 800); },
    plant() { blip(880, 0.12, 'sine', 0.1); blip(1320, 0.12, 'sine', 0.08); },
    explosion() { noise(0.7, 0.5, 420); blip(70, 0.6, 'sine', 0.25, 32); },
    roundEnd(win) { blip(win ? 523 : 392, 0.22, 'triangle', 0.12); setTimeout(() => blip(win ? 784 : 330, 0.3, 'triangle', 0.12), 180); },
  };
}
