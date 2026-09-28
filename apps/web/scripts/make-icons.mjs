// Generates placeholder PWA icons (solid brand square with a white "record" dot) without image deps.
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

function png(size, { maskable }) {
  const bg = [30, 64, 175]; // blue-800
  const r = size * (maskable ? 0.22 : 0.3);
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - size / 2 + 0.5, y - size / 2 + 0.5);
      const t = Math.min(1, Math.max(0, r - d + 0.5)); // anti-aliased edge
      const px = bg.map((c) => Math.round(c + (255 - c) * t));
      px.forEach((v, i) => (raw[y * (size * 3 + 1) + 1 + x * 3 + i] = v));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

writeFileSync("public/icons/icon-192.png", png(192, { maskable: false }));
writeFileSync("public/icons/icon-512.png", png(512, { maskable: false }));
writeFileSync("public/icons/icon-maskable-512.png", png(512, { maskable: true }));
writeFileSync("public/icons/apple-touch-icon.png", png(180, { maskable: true }));
console.log("icons written");
