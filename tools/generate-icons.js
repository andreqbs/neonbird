/**
 * Gera os PNGs do app (icone, icone adaptativo, splash e favicon) por desenho,
 * sem editor de imagem e sem dependencia externa.
 *
 *   node tools/generate-icons.js
 *
 * O PNG e escrito na mao: cabecalho + IDAT comprimido com o zlib do proprio Node.
 * As formas usam cobertura suavizada em 1 px (em vez de supersampling), o que da
 * borda limpa a um custo baixo.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'assets');

// Mesma paleta de src/ui/theme.js
const C = {
  deep: [8, 12, 34],
  panel: [19, 28, 68],
  bird: [255, 213, 74],
  wing: [226, 131, 15],
  beak: [255, 107, 53],
  neon: [46, 230, 197],
  dark: [26, 19, 48],
  white: [255, 255, 255],
};

// ------------------------------------------------------------------- canvas

function createCanvas(size) {
  return { size, data: new Float32Array(size * size * 4) }; // RGBA 0..255 / alpha 0..1
}

/** Mistura uma cor sobre o pixel, com cobertura `a` (0..1). */
function blend(cv, x, y, [r, g, b], a) {
  if (a <= 0) return;
  const i = (y * cv.size + x) * 4;
  const dst = cv.data[i + 3];
  const out = a + dst * (1 - a);
  if (out <= 0) return;
  cv.data[i] = (r * a + cv.data[i] * dst * (1 - a)) / out;
  cv.data[i + 1] = (g * a + cv.data[i + 1] * dst * (1 - a)) / out;
  cv.data[i + 2] = (b * a + cv.data[i + 2] * dst * (1 - a)) / out;
  cv.data[i + 3] = out;
}

/** Cobertura de uma borda: 1 dentro, 0 fora, suavizado em ~1 px. */
const coverage = (signedDistance) => Math.max(0, Math.min(1, 0.5 - signedDistance));

/**
 * Percorre uma caixa e pinta segundo uma funcao de distancia assinada.
 * `sdf(x, y)` deve devolver distancia negativa dentro da forma.
 */
function paint(cv, box, sdf, color, alpha = 1) {
  const x0 = Math.max(0, Math.floor(box[0]));
  const y0 = Math.max(0, Math.floor(box[1]));
  const x1 = Math.min(cv.size - 1, Math.ceil(box[2]));
  const y1 = Math.min(cv.size - 1, Math.ceil(box[3]));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const a = coverage(sdf(x + 0.5, y + 0.5)) * alpha;
      if (a > 0) blend(cv, x, y, color, a);
    }
  }
}

function circle(cv, cx, cy, r, color, alpha = 1) {
  paint(cv, [cx - r - 1, cy - r - 1, cx + r + 1, cy + r + 1],
    (x, y) => Math.hypot(x - cx, y - cy) - r, color, alpha);
}

/** Elipse com rotacao, para a asa. */
function ellipse(cv, cx, cy, rx, ry, deg, color, alpha = 1) {
  const t = (deg * Math.PI) / 180;
  const cos = Math.cos(-t);
  const sin = Math.sin(-t);
  const rad = Math.max(rx, ry) + 2;
  paint(cv, [cx - rad, cy - rad, cx + rad, cy + rad], (x, y) => {
    const dx = x - cx;
    const dy = y - cy;
    const u = (dx * cos - dy * sin) / rx;
    const v = (dx * sin + dy * cos) / ry;
    // aproxima a distancia real escalando pelo menor raio
    return (Math.hypot(u, v) - 1) * Math.min(rx, ry);
  }, color, alpha);
}

/** Triangulo (usado no bico). */
function triangle(cv, p1, p2, p3, color, alpha = 1) {
  const xs = [p1[0], p2[0], p3[0]];
  const ys = [p1[1], p2[1], p3[1]];
  const edge = (a, b, x, y) => (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
  const area = edge(p1, p2, p3[0], p3[1]);
  const sign = area >= 0 ? 1 : -1;
  paint(cv, [Math.min(...xs) - 2, Math.min(...ys) - 2, Math.max(...xs) + 2, Math.max(...ys) + 2],
    (x, y) => {
      const d = Math.min(
        sign * edge(p1, p2, x, y),
        sign * edge(p2, p3, x, y),
        sign * edge(p3, p1, x, y)
      );
      // normaliza grosseiramente para a suavizacao ficar em ~1 px
      return -d / Math.max(1, Math.abs(area) / 40);
    }, color, alpha);
}

/** Halo suave: circulos concentricos com alpha caindo. */
function glow(cv, cx, cy, inner, outer, color, strength = 0.5) {
  paint(cv, [cx - outer, cy - outer, cx + outer, cy + outer], (x, y) => {
    const d = Math.hypot(x - cx, y - cy);
    return d < outer ? -1 : 1;
  }, color, 0); // no-op: mantido para clareza da caixa
  const x0 = Math.max(0, Math.floor(cx - outer));
  const y0 = Math.max(0, Math.floor(cy - outer));
  const x1 = Math.min(cv.size - 1, Math.ceil(cx + outer));
  const y1 = Math.min(cv.size - 1, Math.ceil(cy + outer));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d >= outer) continue;
      const k = d <= inner ? 1 : 1 - (d - inner) / (outer - inner);
      blend(cv, x, y, color, k * k * strength);
    }
  }
}

function fillBackground(cv, top, bottom) {
  for (let y = 0; y < cv.size; y++) {
    const k = y / (cv.size - 1);
    const col = [
      top[0] + (bottom[0] - top[0]) * k,
      top[1] + (bottom[1] - top[1]) * k,
      top[2] + (bottom[2] - top[2]) * k,
    ];
    for (let x = 0; x < cv.size; x++) blend(cv, x, y, col, 1);
  }
}

// ------------------------------------------------------------------ passaro

/**
 * Desenha o passaro do jogo. `s` e o "tamanho" do corpo (diametro).
 * Mesmas proporcoes do Bird.js, para o icone e o jogo combinarem.
 */
function drawBird(cv, cx, cy, s, { withGlow = true } = {}) {
  const r = s / 2;
  if (withGlow) glow(cv, cx, cy, r * 0.9, r * 2.1, C.bird, 0.4);

  // cauda (bem para fora, senao some atras do corpo)
  ellipse(cv, cx - r * 1.02, cy + r * 0.12, r * 0.4, r * 0.26, -14, C.wing);
  // corpo
  circle(cv, cx, cy, r, C.bird);
  // barriga
  ellipse(cv, cx + r * 0.02, cy + r * 0.4, r * 0.55, r * 0.36, 0, [255, 240, 184], 0.7);
  // asa
  ellipse(cv, cx - r * 0.26, cy + r * 0.16, r * 0.42, r * 0.24, -18, C.wing);
  // olho
  circle(cv, cx + r * 0.34, cy - r * 0.3, r * 0.3, C.white);
  circle(cv, cx + r * 0.42, cy - r * 0.26, r * 0.14, C.dark);
  // bico
  triangle(
    cv,
    [cx + r * 0.7, cy + r * 0.02],
    [cx + r * 1.32, cy + r * 0.2],
    [cx + r * 0.68, cy + r * 0.42],
    C.beak
  );
}

// ---------------------------------------------------------------------- PNG

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(cv) {
  const { size, data } = cv;
  // Cada linha do PNG comeca com o byte de filtro (0 = nenhum).
  const raw = Buffer.alloc((size * 4 + 1) * size);
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0;
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const a = data[i + 3];
      raw[p++] = Math.round(Math.max(0, Math.min(255, data[i])));
      raw[p++] = Math.round(Math.max(0, Math.min(255, data[i + 1])));
      raw[p++] = Math.round(Math.max(0, Math.min(255, data[i + 2])));
      raw[p++] = Math.round(Math.max(0, Math.min(255, a * 255)));
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bits por canal
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function write(name, cv) {
  const buf = encodePNG(cv);
  fs.writeFileSync(path.join(OUT, name), buf);
  console.log(`  ${name.padEnd(20)} ${cv.size}x${cv.size}  ${(buf.length / 1024).toFixed(0)} KB`);
}

// --------------------------------------------------------------------- main

fs.mkdirSync(OUT, { recursive: true });
console.log('Gerando imagens em assets/:');

// Icone do app: fundo escuro, anel neon e o passaro.
{
  const cv = createCanvas(1024);
  fillBackground(cv, C.panel, C.deep);
  glow(cv, 512, 640, 120, 620, C.neon, 0.16);
  circle(cv, 512, 512, 430, C.neon, 0.18);
  circle(cv, 512, 512, 414, C.deep, 1);
  drawBird(cv, 505, 512, 415);
  write('icon.png', cv);
}

// Icone adaptativo (Android): so o primeiro plano, e menor — o sistema recorta
// tudo que passa do circulo central.
{
  const cv = createCanvas(1024);
  drawBird(cv, 508, 512, 380);
  write('adaptive-icon.png', cv);
}

// Splash: passaro sobre fundo transparente, o Expo pinta o fundo por tras.
{
  const cv = createCanvas(512);
  drawBird(cv, 255, 256, 290);
  write('splash-icon.png', cv);
}

// Favicon da versao web.
{
  const cv = createCanvas(64);
  fillBackground(cv, C.panel, C.deep);
  drawBird(cv, 32, 32, 42, { withGlow: false });
  write('favicon.png', cv);
}

console.log('pronto.');
