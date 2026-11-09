// Re-encode an RGB/RGBA 8-bit PNG as a 256-colour indexed PNG (median cut,
// light Floyd–Steinberg dithering). No dependencies: node zlib only.
// usage: node quantize.cjs in.png out.png [dither 0..1]
const fs = require('fs');
const zlib = require('zlib');

function crcTable() { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; }
const CRC = crcTable();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

function decode(buf) {
  let off = 8, w, h, type, idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), kind = buf.toString('ascii', off + 4, off + 8), data = buf.subarray(off + 8, off + 8 + len);
    if (kind === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); type = data[9]; if (data[8] !== 8 || data[12] !== 0) throw new Error('unsupported'); }
    if (kind === 'IDAT') idat.push(data);
    off += 12 + len;
  }
  const bpp = type === 6 ? 4 : type === 2 ? 3 : 0; if (!bpp) throw new Error('type ' + type);
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * bpp, out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[dst + x - bpp] : 0, b = y > 0 ? out[dst - stride + x] : 0, c = x >= bpp && y > 0 ? out[dst - stride + x - bpp] : 0;
      let v = raw[src + x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[dst + x] = v & 0xff;
    }
  }
  const rgb = new Uint8Array(w * h * 3);
  for (let i = 0; i < w * h; i++) { rgb[i * 3] = out[i * bpp]; rgb[i * 3 + 1] = out[i * bpp + 1]; rgb[i * 3 + 2] = out[i * bpp + 2]; }
  return { w, h, rgb };
}

function medianCut(rgb, n) {
  // histogram on 5-bit-per-channel buckets keeps it fast
  const hist = new Map();
  for (let i = 0; i < rgb.length; i += 3) { const k = (rgb[i] << 16) | (rgb[i + 1] << 8) | rgb[i + 2]; hist.set(k, (hist.get(k) || 0) + 1); }
  const colors = [...hist.entries()].map(([k, c]) => [k >> 16, (k >> 8) & 255, k & 255, c]);
  let boxes = [colors];
  const range = (b) => { const lo = [255, 255, 255], hi = [0, 0, 0]; for (const c of b) for (let j = 0; j < 3; j++) { if (c[j] < lo[j]) lo[j] = c[j]; if (c[j] > hi[j]) hi[j] = c[j]; } return hi.map((v, j) => v - lo[j]); };
  const weight = (b) => b.reduce((s, c) => s + c[3], 0);
  while (boxes.length < n) {
    let best = -1, bi = -1;
    for (let i = 0; i < boxes.length; i++) { if (boxes[i].length < 2) continue; const r = range(boxes[i]); const score = Math.max(...r) * Math.sqrt(weight(boxes[i])); if (score > best) { best = score; bi = i; } }
    if (bi < 0) break;
    const b = boxes[bi], r = range(b), ax = r.indexOf(Math.max(...r));
    b.sort((p, q) => p[ax] - q[ax]);
    const half = weight(b) / 2; let acc = 0, cut = 1;
    for (let i = 0; i < b.length - 1; i++) { acc += b[i][3]; if (acc >= half) { cut = i + 1; break; } }
    boxes.splice(bi, 1, b.slice(0, cut), b.slice(cut));
  }
  return boxes.map((b) => { const w = weight(b); return [0, 1, 2].map((j) => Math.round(b.reduce((s, c) => s + c[j] * c[3], 0) / w)); });
}

function remap(w, h, rgb, pal, dither) {
  const cache = new Map(), idx = new Uint8Array(w * h);
  const err = new Float32Array((w + 2) * 2 * 3);
  const nearest = (r, g, b) => {
    const k = (r << 16) | (g << 8) | b; const hit = cache.get(k); if (hit !== undefined) return hit;
    let bd = Infinity, bi = 0;
    for (let i = 0; i < pal.length; i++) { const p = pal[i], d = (p[0] - r) ** 2 * 3 + (p[1] - g) ** 2 * 4 + (p[2] - b) ** 2 * 2; if (d < bd) { bd = d; bi = i; } }
    cache.set(k, bi); return bi;
  };
  for (let y = 0; y < h; y++) {
    const cur = (y & 1) * (w + 2) * 3, nxt = ((y + 1) & 1) * (w + 2) * 3;
    err.fill(0, nxt, nxt + (w + 2) * 3);
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3, e = cur + (x + 1) * 3;
      const r = Math.max(0, Math.min(255, Math.round(rgb[i] + err[e]))), g = Math.max(0, Math.min(255, Math.round(rgb[i + 1] + err[e + 1]))), b = Math.max(0, Math.min(255, Math.round(rgb[i + 2] + err[e + 2])));
      const p = nearest(r, g, b); idx[y * w + x] = p;
      if (dither > 0) {
        const q = pal[p], d = [(r - q[0]) * dither, (g - q[1]) * dither, (b - q[2]) * dither];
        for (let j = 0; j < 3; j++) { err[e + 3 + j] += d[j] * 7 / 16; err[nxt + x * 3 + j] += d[j] * 3 / 16; err[nxt + (x + 1) * 3 + j] += d[j] * 5 / 16; err[nxt + (x + 2) * 3 + j] += d[j] / 16; }
      }
    }
  }
  return idx;
}

function chunk(kind, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(kind, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encode(w, h, idx, pal) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 3;
  const plte = Buffer.alloc(pal.length * 3); pal.forEach((p, i) => { plte[i * 3] = p[0]; plte[i * 3 + 1] = p[1]; plte[i * 3 + 2] = p[2]; });
  const raw = Buffer.alloc(h * (w + 1));
  for (let y = 0; y < h; y++) { raw[y * (w + 1)] = 0; Buffer.from(idx.buffer, y * w, w).copy(raw, y * (w + 1) + 1); }
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('PLTE', plte), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const [, , inp, out, ditherArg] = process.argv;
const { w, h, rgb } = decode(fs.readFileSync(inp));
const pal = medianCut(rgb, 256);
const png = encode(w, h, remap(w, h, rgb, pal, ditherArg === undefined ? 0.6 : Number(ditherArg)), pal);
fs.writeFileSync(out, png);
console.log(`${inp} -> ${out}: ${(fs.statSync(inp).size / 1024).toFixed(0)}KB -> ${(png.length / 1024).toFixed(0)}KB`);
