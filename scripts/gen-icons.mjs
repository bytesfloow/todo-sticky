// 生成 src-tauri/icons 下的应用图标（黄色便签样式）
import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, "src-tauri", "icons");
fs.mkdirSync(outDir, { recursive: true });

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let c = 0xffffffff;
  for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const t = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

function makePng(size) {
  const px = Buffer.alloc(size * size * 4);
  const set = (x, y, r, g, b, a = 255) => {
    const i = (y * size + x) * 4;
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
  };
  const u = size / 32; // 以 32x32 为基准缩放

  // 圆角矩形判断
  const rad = 5 * u;
  const inNote = (x, y) => {
    const x0 = 1 * u, y0 = 2 * u, x1 = 31 * u, y1 = 31 * u;
    if (x < x0 || x > x1 || y < y0 || y > y1) return false;
    const cx = Math.max(x0 + rad, Math.min(x, x1 - rad));
    const cy = Math.max(y0 + rad, Math.min(y, y1 - rad));
    return (x - cx) ** 2 + (y - cy) ** 2 <= rad * rad;
  };
  const isBorder = (x, y) =>
    inNote(x, y) && !(inNote(x - 1.2 * u, y) && inNote(x + 1.2 * u, y) && inNote(x, y - 1.2 * u) && inNote(x, y + 1.2 * u));

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (isBorder(x, y)) set(x, y, 0xc9, 0xa9, 0x3a);
      else if (inNote(x, y)) set(x, y, 0xf5, 0xe5, 0x8a);
    }
  }

  // 顶部胶带
  const tape = { x0: 11 * u, y0: 0, x1: 21 * u, y1: 5 * u };
  for (let y = Math.floor(tape.y0); y < Math.min(size, tape.y1); y++)
    for (let x = Math.floor(tape.x0); x < Math.min(size, tape.x1); x++)
      if (y < size) set(x, y, 0x9f, 0xc5, 0xe8, 230);

  // 三行“文字”
  const lines = [9, 15, 21];
  for (const ly of lines) {
    for (let y = Math.floor(ly * u); y < Math.floor((ly + 2) * u) && y < size; y++)
      for (let x = Math.floor(5 * u); x < Math.floor(27 * u) && x < size; x++)
        set(x, y, 0x8a, 0x7a, 0x3a);
  }

  // 编码 PNG
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function makeIco(png32, png128) {
  const images = [
    { size: 32, data: png32 },
    { size: 128, data: png128 },
  ];
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + 16 * images.length;
  for (const img of images) {
    const e = Buffer.alloc(16);
    e[0] = img.size === 256 ? 0 : img.size;
    e[1] = img.size === 256 ? 0 : img.size;
    e.writeUInt16LE(1, 4);  // color planes
    e.writeUInt16LE(32, 6); // bpp
    e.writeUInt32LE(img.data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += img.data.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

const png32 = makePng(32);
const png128 = makePng(128);
fs.writeFileSync(path.join(outDir, "32x32.png"), png32);
fs.writeFileSync(path.join(outDir, "128x128.png"), png128);
fs.writeFileSync(path.join(outDir, "icon.png"), png128);
fs.writeFileSync(path.join(outDir, "icon.ico"), makeIco(png32, png128));
console.log("图标已生成到", outDir);
