// Builds every icon/logo from branding/logo-source.png (no external tools):
//   - removes the white background (flood fill from the border + edge un-blending)
//   - crops to the rounded square and resamples with an area filter (premultiplied alpha)
// Outputs: branding/logo.png (master), apps/desktop/build/icon.png + icon.ico,
//          apps/web/public/favicon.png, apps/web/src/assets/logo.png
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync, inflateSync } from "node:zlib";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SOURCE = join(root, "branding", "logo-source.png");

// ---------- PNG decode / encode (8-bit RGB/RGBA, non-interlaced) ----------
function decodePng(buf) {
  let o = 8, w = 0, h = 0, colorType = 0, depth = 0, interlace = 0;
  const idat = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o), type = buf.toString("ascii", o + 4, o + 8), d = buf.subarray(o + 8, o + 8 + len);
    if (type === "IHDR") { w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]; colorType = d[9]; interlace = d[12]; }
    if (type === "IDAT") idat.push(d);
    o += 12 + len;
  }
  if (depth !== 8 || (colorType !== 6 && colorType !== 2) || interlace) throw new Error("unsupported PNG (need 8-bit RGB/RGBA, non-interlaced)");
  const bpp = colorType === 6 ? 4 : 3, stride = w * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  const px = Buffer.alloc(w * h * bpp);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const r = raw[y * (stride + 1) + 1 + x];
      const a = x >= bpp ? px[y * stride + x - bpp] : 0, b = y ? px[(y - 1) * stride + x] : 0, c = x >= bpp && y ? px[(y - 1) * stride + x - bpp] : 0;
      let v = r;
      if (f === 1) v = r + a;
      else if (f === 2) v = r + b;
      else if (f === 3) v = r + ((a + b) >> 1);
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v = r + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
      px[y * stride + x] = v & 255;
    }
  }
  if (bpp === 4) return { w, h, data: px };
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) { rgba[i * 4] = px[i * 3]; rgba[i * 4 + 1] = px[i * 3 + 1]; rgba[i * 4 + 2] = px[i * 3 + 2]; rgba[i * 4 + 3] = 255; }
  return { w, h, data: rgba };
}

const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = (buf) => { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng({ w, h, data }) {
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) data.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

// ---------- background removal ----------
function removeWhiteBackground(img) {
  const { w, h, data } = img;
  const minC = (i) => Math.min(data[i], data[i + 1], data[i + 2]);
  // 1) exterior = light pixels connected to the image border
  const outside = new Uint8Array(w * h);
  const stack = [];
  for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
  while (stack.length) {
    const p = stack.pop();
    if (outside[p] || minC(p * 4) < 200) continue;
    outside[p] = 1;
    const x = p % w, y = (p / w) | 0;
    if (x > 0) stack.push(p - 1);
    if (x < w - 1) stack.push(p + 1);
    if (y > 0) stack.push(p - w);
    if (y < h - 1) stack.push(p + w);
  }
  // 2) colour of the shape's rim: median of opaque pixels touching the exterior from inside
  const rim = [];
  for (let p = 0; p < w * h; p++) {
    if (outside[p]) continue;
    const x = p % w, y = (p / w) | 0;
    const near = (x > 2 && outside[p - 3]) || (x < w - 3 && outside[p + 3]) || (y > 2 && outside[p - 3 * w]) || (y < h - 3 && outside[p + 3 * w]);
    if (near && minC(p * 4) < 120) rim.push([data[p * 4], data[p * 4 + 1], data[p * 4 + 2]]);
  }
  const med = (k) => rim.map((c) => c[k]).sort((a, b) => a - b)[rim.length >> 1] ?? 0;
  const F = [med(0), med(1), med(2)];
  const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
  const WHITE = 250; // the source background is 253..255; treat it as fully transparent
  const lf = lum(...F);
  // 3) alpha by un-blending the anti-aliased edge (within 2 px of the exterior) against white
  const edge = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) {
    if (!outside[p]) continue;
    const x = p % w, y = (p / w) | 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && xx < w && yy >= 0 && yy < h) edge[yy * w + xx] = 1;
    }
  }
  const out = Buffer.from(data);
  for (let p = 0; p < w * h; p++) {
    const i = p * 4;
    if (!outside[p] && !edge[p]) continue;
    const l = lum(data[i], data[i + 1], data[i + 2]);
    const a = Math.max(0, Math.min(1, (WHITE - l) / (WHITE - lf)));
    if (outside[p] || a < 1) {
      out[i] = F[0]; out[i + 1] = F[1]; out[i + 2] = F[2];
      out[i + 3] = Math.round(a * 255);
    }
  }
  return { img: { w, h, data: out }, rim: F };
}

function crop(img) {
  const { w, h, data } = img;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (data[(y * w + x) * 4 + 3] > 0) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  const size = Math.max(x1 - x0 + 1, y1 - y0 + 1);
  const ox = x0 - Math.floor((size - (x1 - x0 + 1)) / 2), oy = y0 - Math.floor((size - (y1 - y0 + 1)) / 2);
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const sx = ox + x, sy = oy + y;
    if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
    data.copy(out, (y * size + x) * 4, (sy * w + sx) * 4, (sy * w + sx) * 4 + 4);
  }
  return { w: size, h: size, data: out, box: [x0, y0, x1, y1] };
}

/** Area-averaging resample in premultiplied alpha (good for large reductions). */
function resize(img, size) {
  const { w, h, data } = img;
  const out = Buffer.alloc(size * size * 4);
  const sx = w / size, sy = h / size;
  for (let y = 0; y < size; y++) {
    const fy0 = y * sy, fy1 = fy0 + sy;
    for (let x = 0; x < size; x++) {
      const fx0 = x * sx, fx1 = fx0 + sx;
      let r = 0, g = 0, b = 0, a = 0, area = 0;
      for (let yy = Math.floor(fy0); yy < Math.ceil(fy1); yy++) {
        const wy = Math.min(fy1, yy + 1) - Math.max(fy0, yy);
        for (let xx = Math.floor(fx0); xx < Math.ceil(fx1); xx++) {
          const wgt = wy * (Math.min(fx1, xx + 1) - Math.max(fx0, xx));
          const i = (yy * w + xx) * 4, al = data[i + 3] / 255;
          r += data[i] * al * wgt; g += data[i + 1] * al * wgt; b += data[i + 2] * al * wgt; a += al * wgt; area += wgt;
        }
      }
      const o = (y * size + x) * 4;
      if (a > 0) { out[o] = Math.round(r / a); out[o + 1] = Math.round(g / a); out[o + 2] = Math.round(b / a); }
      out[o + 3] = Math.round((a / area) * 255);
    }
  }
  return { w: size, h: size, data: out };
}

function ico(images) {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, png }, k) => {
    const e = 6 + k * 16;
    header[e] = size >= 256 ? 0 : size; header[e + 1] = size >= 256 ? 0 : size;
    header.writeUInt16LE(1, e + 4); header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(png.length, e + 8); header.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images.map((i) => i.png)]);
}

// ---------- pipeline ----------
const src = decodePng(readFileSync(SOURCE));
const { img: cut, rim } = removeWhiteBackground(src);
const master = crop(cut);
const write = (rel, buf) => { const f = join(root, rel); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, buf); return rel; };
const written = [
  write("branding/logo.png", encodePng(master)),
  write("apps/desktop/build/icon.png", encodePng(resize(master, 512))),
  write("apps/web/src/assets/logo.png", encodePng(resize(master, 256))),
  write("apps/web/public/favicon.png", encodePng(resize(master, 64))),
];
const sizes = [256, 128, 64, 48, 32, 24, 16];
written.push(write("apps/desktop/build/icon.ico", ico(sizes.map((s) => ({ size: s, png: encodePng(resize(master, s)) })))));
console.log(`source ${src.w}x${src.h}, rim colour rgb(${rim.join(",")}), shape box ${master.box.join(",")} -> master ${master.w}px`);
for (const f of written) console.log(`  ${f}`);
