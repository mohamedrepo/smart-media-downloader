/**
 * Generates the extension icons (16/48/128 PNG) with zero dependencies.
 *
 * Produces a blue rounded square with a white download arrow. PNG encoding
 * is done manually: IHDR + IDAT (zlib-deflated RGB scanlines) + IEND, with
 * a CRC32 checksum per chunk. Run: npm run icons
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

// --- CRC32 ---------------------------------------------------------------
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

// --- PNG assembly ---------------------------------------------------------
function chunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([len, typeBytes, data, crc]);
}

function encodePng(width, height, pixelAt) {
  const raw = Buffer.alloc(height * (1 + width * 3));
  let offset = 0;
  for (let y = 0; y < height; y++) {
    raw[offset++] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const [rr, gg, bb] = pixelAt(x, y);
      raw[offset++] = rr;
      raw[offset++] = gg;
      raw[offset++] = bb;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- Icon artwork -----------------------------------------------------------
function pixelFactory(size) {
  const r = size * 0.18; // corner radius
  return (x, y) => {
    // Rounded-corner mask: transparent corners become the flat edge color.
    const cx = [r, size - r];
    const cy = [r, size - r];
    for (const rx of cx) {
      for (const ry of cy) {
        const inCornerX = (rx === r && x < r) || (rx === size - r && x > size - r);
        const inCornerY = (ry === r && y < r) || (ry === size - r && y > size - r);
        if (inCornerX && inCornerY) {
          const dx = x - rx;
          const dy = y - ry;
          if (dx * dx + dy * dy > r * r) {
            // Outside the rounded corner — render as white border ring
            return [255, 255, 255];
          }
        }
      }
    }
    // Diagonal gradient background: #3b82f6 -> #1d4ed8
    const t = (x + y) / (2 * size);
    const bg = [
      Math.round(0x3b + (0x1d - 0x3b) * t),
      Math.round(0x82 + (0x4e - 0x82) * t),
      Math.round(0xf6 + (0xd8 - 0xf6) * t),
    ];
    // White download arrow: stem + triangle head
    const nx = x / size;
    const ny = y / size;
    const stem = nx >= 0.44 && nx <= 0.56 && ny >= 0.24 && ny <= 0.52;
    const headT = (ny - 0.48) / 0.26; // 0..1 across the head
    const halfWidth = 0.2 * headT;
    const head = ny >= 0.48 && ny <= 0.74 && Math.abs(nx - 0.5) <= halfWidth;
    if (stem || head) return [255, 255, 255];
    return bg;
  };
}

const outDir = join(root, 'public', 'icons');
mkdirSync(outDir, { recursive: true });
for (const size of [16, 48, 128]) {
  const png = encodePng(size, size, pixelFactory(size));
  writeFileSync(join(outDir, `icon${size}.png`), png);
  console.log(`wrote icons/icon${size}.png (${png.length} bytes)`);
}
