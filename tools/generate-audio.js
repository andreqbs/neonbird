/**
 * Gera os arquivos de audio do jogo por sintese, direto em WAV.
 *
 *   node tools/generate-audio.js
 *
 * A ideia e nao depender de assets externos (licenca, download, peso de repo):
 * tudo aqui e onda quadrada, triangular e ruido, do jeito que um console 8-bit
 * faria. Mexa nas constantes e rode de novo para mudar a trilha.
 */
const fs = require('fs');
const path = require('path');

const SR = 22050; // 22 kHz mono ja e de sobra para chiptune
const OUT = path.join(__dirname, '..', 'assets', 'audio');

// ---------------------------------------------------------------- utilitarios

function writeWav(name, samples) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); // tamanho do bloco fmt
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits por amostra
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  const file = path.join(OUT, name);
  fs.writeFileSync(file, buf);
  console.log(`  ${name.padEnd(12)} ${(buf.length / 1024).toFixed(0)} KB  ${(n / SR).toFixed(2)}s`);
}

const secs = (s) => Math.round(s * SR);

// osciladores (fase normalizada 0..1)
const square = (p, duty = 0.5) => (p % 1 < duty ? 1 : -1);
const triangle = (p) => {
  const x = p % 1;
  return x < 0.5 ? 4 * x - 1 : 3 - 4 * x;
};
const sine = (p) => Math.sin(p * Math.PI * 2);

// ruido branco com semente fixa, para o resultado ser sempre o mesmo
let seed = 12345;
const noise = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return (seed / 0x3fffffff) - 1;
};

/** Envelope ataque/decaimento/sustentacao/relaxamento, em fracao do tempo. */
function adsr(t, dur, a, d, s, r) {
  if (t < a) return t / a;
  if (t < a + d) return 1 - (1 - s) * ((t - a) / d);
  if (t < dur - r) return s;
  if (t < dur) return s * (1 - (t - (dur - r)) / r);
  return 0;
}

/** Soma uma nota no buffer, comecando em `start` segundos. */
function addNote(buf, start, dur, freq, opts = {}) {
  const {
    wave = 'square',
    duty = 0.5,
    gain = 0.2,
    a = 0.005,
    d = 0.05,
    s = 0.7,
    r = 0.05,
    glide = 0, // multiplicador de frequencia no fim da nota
    vibrato = 0,
  } = opts;

  const i0 = secs(start);
  const n = secs(dur);
  let phase = 0;

  for (let i = 0; i < n; i++) {
    const idx = i0 + i;
    if (idx < 0 || idx >= buf.length) continue;
    const t = i / SR;
    const k = i / n;

    let f = glide ? freq * Math.pow(glide, k) : freq;
    if (vibrato) f *= 1 + Math.sin(t * Math.PI * 2 * 6) * vibrato;
    phase += f / SR;

    let v;
    if (wave === 'square') v = square(phase, duty);
    else if (wave === 'triangle') v = triangle(phase);
    else if (wave === 'sine') v = sine(phase);
    else v = noise();

    buf[idx] += v * gain * adsr(t, dur, a, d, s, r);
  }
}

/** Ruido com filtro passa-baixa de um polo — vira "ar" em vez de chiado. */
function addNoise(buf, start, dur, opts = {}) {
  const { gain = 0.2, cutoff = 0.25, a = 0.005, d = 0.03, s = 0.4, r = 0.05 } = opts;
  const i0 = secs(start);
  const n = secs(dur);
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const idx = i0 + i;
    if (idx < 0 || idx >= buf.length) continue;
    const t = i / SR;
    lp += (noise() - lp) * cutoff;
    buf[idx] += lp * gain * adsr(t, dur, a, d, s, r);
  }
}

/** Limitador suave, para nada estourar ao somar as camadas. */
function softClip(buf) {
  for (let i = 0; i < buf.length; i++) buf[i] = Math.tanh(buf[i] * 1.2) * 0.85;
  return buf;
}

/** Fade nas pontas: evita o "clique" na emenda do loop. */
function fadeEdges(buf, ms = 8) {
  const n = Math.round((ms / 1000) * SR);
  for (let i = 0; i < n; i++) {
    const k = i / n;
    buf[i] *= k;
    buf[buf.length - 1 - i] *= k;
  }
  return buf;
}

// ------------------------------------------------------------------- efeitos

/** Toque para voar: um "blip" curto subindo, com um sopro de ar junto. */
function makeFlap() {
  const buf = new Float32Array(secs(0.13));
  addNote(buf, 0, 0.1, 320, {
    wave: 'square', duty: 0.35, gain: 0.34, glide: 2.6, a: 0.002, d: 0.03, s: 0.5, r: 0.05,
  });
  addNoise(buf, 0, 0.09, { gain: 0.12, cutoff: 0.45, a: 0.002, d: 0.04, s: 0.15, r: 0.04 });
  return fadeEdges(softClip(buf), 4);
}

/** Ponto: duas notas rapidas subindo, tipo moeda. */
function makeScore() {
  const buf = new Float32Array(secs(0.2));
  addNote(buf, 0, 0.055, 987.77, { wave: 'square', duty: 0.5, gain: 0.26, a: 0.002, d: 0.02, s: 0.8, r: 0.02 });
  addNote(buf, 0.05, 0.13, 1318.51, { wave: 'square', duty: 0.5, gain: 0.26, a: 0.002, d: 0.04, s: 0.6, r: 0.07 });
  addNote(buf, 0.05, 0.13, 1975.53, { wave: 'triangle', gain: 0.1, a: 0.002, d: 0.04, s: 0.4, r: 0.07 });
  return fadeEdges(softClip(buf), 4);
}

/** Colisao: impacto grave que despenca, com estalo de ruido. */
function makeHit() {
  const buf = new Float32Array(secs(0.42));
  addNote(buf, 0, 0.32, 190, {
    wave: 'square', duty: 0.5, gain: 0.4, glide: 0.28, a: 0.001, d: 0.12, s: 0.45, r: 0.16,
  });
  addNote(buf, 0, 0.3, 95, { wave: 'triangle', gain: 0.3, glide: 0.3, a: 0.001, d: 0.1, s: 0.5, r: 0.16 });
  addNoise(buf, 0, 0.14, { gain: 0.22, cutoff: 0.6, a: 0.001, d: 0.06, s: 0.2, r: 0.06 });
  return fadeEdges(softClip(buf), 6);
}

// ------------------------------------------------------------------- trilha

const NOTE = {
  C2: 65.41, D2: 73.42, E2: 82.41, F2: 87.31, G2: 98.0, A2: 110.0, B2: 123.47,
  C3: 130.81, D3: 146.83, E3: 164.81, F3: 174.61, G3: 196.0, A3: 220.0, B3: 246.94,
  C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.0, A4: 440.0, B4: 493.88,
  C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880.0,
};

/**
 * Loop de 16 s em La menor, 120 BPM: baixo, arpejo, melodia e um chimbal seco.
 * Progressao Am - F - C - G, duas voltas com melodias diferentes.
 */
function makeMusic() {
  const bpm = 120;
  const beat = 60 / bpm; // 0.5s
  const bar = beat * 4; // 2s
  const bars = 8;
  const total = bar * bars; // 16s
  const buf = new Float32Array(secs(total));

  const chords = [
    { root: 'A2', arp: ['A3', 'C4', 'E4'] },
    { root: 'F2', arp: ['F3', 'A3', 'C4'] },
    { root: 'C3', arp: ['C4', 'E4', 'G4'] },
    { root: 'G2', arp: ['G3', 'B3', 'D4'] },
  ];

  for (let b = 0; b < bars; b++) {
    const t0 = b * bar;
    const ch = chords[b % 4];

    // baixo: duas semínimas por compasso
    for (const off of [0, beat * 2]) {
      addNote(buf, t0 + off, beat * 1.7, NOTE[ch.root], {
        wave: 'square', duty: 0.5, gain: 0.2, a: 0.005, d: 0.15, s: 0.55, r: 0.2,
      });
    }

    // arpejo: colcheias correndo pelo acorde
    for (let i = 0; i < 8; i++) {
      const f = NOTE[ch.arp[i % 3]];
      addNote(buf, t0 + i * (beat / 2), beat * 0.42, f, {
        wave: 'square', duty: 0.25, gain: 0.085, a: 0.004, d: 0.06, s: 0.4, r: 0.06,
      });
    }

    // chimbal: contratempo
    for (let i = 0; i < 4; i++) {
      addNoise(buf, t0 + i * beat + beat / 2, 0.05, {
        gain: 0.045, cutoff: 0.75, a: 0.001, d: 0.02, s: 0.1, r: 0.02,
      });
    }
  }

  // melodia: frase de 4 compassos, repetida uma oitava de sensacao diferente
  const phraseA = [
    ['A4', 0, 1], ['C5', 1, 0.5], ['B4', 1.5, 0.5], ['A4', 2, 1], ['G4', 3, 1],
    ['F4', 4, 1], ['A4', 5, 0.5], ['G4', 5.5, 0.5], ['F4', 6, 2],
    ['E4', 8, 1], ['G4', 9, 0.5], ['E4', 9.5, 0.5], ['C4', 10, 2],
    ['D4', 12, 1], ['E4', 13, 1], ['G4', 14, 2],
  ];
  const phraseB = [
    ['E5', 0, 0.5], ['C5', 0.5, 0.5], ['A4', 1, 1], ['B4', 2, 1], ['C5', 3, 1],
    ['A4', 4, 1], ['F4', 5, 1], ['C5', 6, 2],
    ['B4', 8, 0.5], ['G4', 8.5, 0.5], ['E4', 9, 1], ['G4', 10, 2],
    ['D5', 12, 1], ['B4', 13, 1], ['A4', 14, 2],
  ];

  for (const [phrase, offsetBars] of [[phraseA, 0], [phraseB, 4]]) {
    for (const [note, atBeat, lenBeat] of phrase) {
      addNote(buf, offsetBars * bar + atBeat * beat, lenBeat * beat * 0.9, NOTE[note], {
        wave: 'triangle', gain: 0.17, a: 0.01, d: 0.1, s: 0.62, r: 0.12, vibrato: 0.004,
      });
    }
  }

  return fadeEdges(softClip(buf), 12);
}

// ---------------------------------------------------------------------- main

fs.mkdirSync(OUT, { recursive: true });
console.log('Gerando audio em assets/audio:');
writeWav('flap.wav', makeFlap());
writeWav('score.wav', makeScore());
writeWav('hit.wav', makeHit());
writeWav('music.wav', makeMusic());
console.log('pronto.');
