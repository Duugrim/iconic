// Minimal PNG encoder for coverage masks: a paletted image where every palette entry is white and
// only its transparency differs. The thumbnails are used as CSS masks (only alpha matters), so
// 16 coverage levels at 4 bits per pixel replace the 32-bit RGBA that resvg writes.
import zlib from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** Applies each PNG filter to one scanline and returns the filtered line with the smallest absolute sum. */
function bestFiltered(line, prev, bpp) {
  const n = line.length;
  let best = null;
  let bestScore = Infinity;
  for (let type = 0; type < 5; type++) {
    const out = Buffer.alloc(n + 1);
    out[0] = type;
    let score = 0;
    for (let i = 0; i < n; i++) {
      const a = i >= bpp ? line[i - bpp] : 0;
      const b = prev ? prev[i] : 0;
      const c = prev && i >= bpp ? prev[i - bpp] : 0;
      let v;
      if (type === 0) v = line[i];
      else if (type === 1) v = line[i] - a;
      else if (type === 2) v = line[i] - b;
      else if (type === 3) v = line[i] - ((a + b) >> 1);
      else v = line[i] - paeth(a, b, c);
      v &= 0xff;
      out[i + 1] = v;
      score += v < 128 ? v : 256 - v;
    }
    if (score < bestScore) {
      bestScore = score;
      best = out;
    }
  }
  return best;
}

/**
 * @param {Uint8Array} rgba width*height*4 bytes; only the alpha channel is kept
 * @param {number} width
 * @param {number} height
 * @param {{levels?: 2|4|16|256}} [opts] number of coverage levels (palette size)
 * @returns {Buffer} PNG bytes
 */
export function encodeMaskPng(rgba, width, height, { levels = 16 } = {}) {
  if (![2, 4, 16, 256].includes(levels)) throw new Error('levels must be 2, 4, 16 or 256');
  const depth = Math.log2(levels);
  const perByte = 8 / depth;
  const rowBytes = Math.ceil(width / perByte);

  const palette = Buffer.alloc(levels * 3, 255);
  const alpha = Buffer.alloc(levels);
  for (let i = 0; i < levels; i++) alpha[i] = Math.round((i * 255) / (levels - 1));

  const raw = [];
  let prev = null;
  for (let y = 0; y < height; y++) {
    const line = Buffer.alloc(rowBytes);
    for (let x = 0; x < width; x++) {
      const level = Math.round((rgba[(y * width + x) * 4 + 3] * (levels - 1)) / 255);
      const shift = 8 - depth * ((x % perByte) + 1);
      line[Math.floor(x / perByte)] |= level << shift;
    }
    raw.push(bestFiltered(line, prev, 1));
    prev = line;
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = depth;
  ihdr[9] = 3; // indexed color
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('PLTE', palette),
    chunk('tRNS', alpha),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(raw), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
