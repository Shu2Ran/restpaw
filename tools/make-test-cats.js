'use strict';

/**
 * 生成 UI 端到端测试用的**合成**猫素材（`tests/fixtures/cats/`）。
 *
 * 为什么需要它：本项目作者的真实猫图**不进版本库**（属个人素材，见 .gitignore），
 * 但「两只猫随机」「眨眼」「伸懒腰」「素材损坏回退」这些用例都需要真实可加载的
 * 图片素材。这里画两只纯几何色块假猫当替身，让 fresh clone 上 25 条用例一条不少地跑。
 *
 * 画法刻意做成睁眼/闭眼**肉眼可区分**（睁眼=实心圆点，闭眼=横杠），
 * 这样「眨眼时短暂切到 closed 图」这类断言才真的在断言东西。
 *
 * 纯 zlib 手写 PNG，零依赖（与 tools/make-icon.js 同一套写法）。
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 512;
const OUT = path.join(__dirname, '..', 'tests', 'fixtures', 'cats');

// 两只假猫的配色：body / 眼睛
const CATS = {
  a: { body: [122, 168, 199] },
  b: { body: [214, 158, 122] },
};

// ---------------------------------------------------------------- PNG 编码

let crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  // 每行前面加一个 filter 字节 0（None）
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- 画图

const inCircle = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
const inEllipse = (x, y, cx, cy, rx, ry) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;

function draw(body, closed) {
  const px = Buffer.alloc(SIZE * SIZE * 4); // 全 0 = 全透明
  const cx = SIZE / 2;
  const cy = SIZE / 2 + 10;
  const dark = [58, 54, 50];

  const put = (x, y, rgb) => {
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
    const i = (y * SIZE + x) * 4;
    px[i] = rgb[0];
    px[i + 1] = rgb[1];
    px[i + 2] = rgb[2];
    px[i + 3] = 255;
  };

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      // 耳朵：两个小圆
      if (inCircle(x, y, cx - 150, cy - 150, 62) || inCircle(x, y, cx + 150, cy - 150, 62)) put(x, y, body);
      // 头
      if (inCircle(x, y, cx, cy, 200)) put(x, y, body);
    }
  }

  for (const ex of [cx - 72, cx + 72]) {
    if (closed) {
      // 闭眼：一条横杠
      for (let x = Math.round(ex - 40); x <= Math.round(ex + 40); x++) {
        for (let y = Math.round(cy - 20); y <= Math.round(cy - 8); y++) put(x, y, dark);
      }
    } else {
      // 睁眼：一个实心圆点
      for (let y = Math.round(cy - 40); y <= Math.round(cy + 10); y++) {
        for (let x = Math.round(ex - 22); x <= Math.round(ex + 22); x++) {
          if (inEllipse(x, y, ex, cy - 15, 20, 26)) put(x, y, dark);
        }
      }
    }
  }
  return px;
}

function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const cats = [];
  for (const [id, spec] of Object.entries(CATS)) {
    for (const kind of ['open', 'closed']) {
      const png = encodePng(SIZE, SIZE, draw(spec.body, kind === 'closed'));
      const file = `${id}-${kind}.png`;
      fs.writeFileSync(path.join(OUT, file), png);
      console.log(`  ${file}  ${png.length} 字节`);
    }
    cats.push({ id, open: `${id}-open.png`, closed: `${id}-closed.png` });
  }
  fs.writeFileSync(
    path.join(OUT, 'manifest.json'),
    `${JSON.stringify({ size: SIZE, cats }, null, 2)}\n`
  );
  console.log(`\n合成素材输出: ${OUT}`);
  console.log('注意：这是几何色块假猫，不是真实猫图，仅供自动化测试使用。');
}

main();