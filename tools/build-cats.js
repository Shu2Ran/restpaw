'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const RAW = path.join(ROOT, 'cats-raw');
const OUT = path.join(ROOT, 'src', 'ui', 'assets', 'cats');
const TMP = path.join(RAW, '.tmp');

const SIZE = 512;
const PAD_RATIO = 0.06;

const CAT_CONFIG = {
  cat1: { out: 'a', crop: { x: 364, y: 144, w: 438, h: 438 } },
  cat2: { out: 'b', crop: { x: 273, y: 42, w: 483, h: 483 } },
};

function magick(args) {
  return execFileSync('convert', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}

function info(args) {
  return execFileSync('identify', args, { encoding: 'utf8' }).trim();
}

function detectBody(file) {
  const out = execFileSync(
    'convert',
    [file, '-alpha', 'extract', '-threshold', '50%', '-define', 'connected-components:verbose=true', '-define', 'connected-components:area-threshold=4000', '-connected-components', '8', 'null:'],
    { encoding: 'utf8' }
  );
  let best = null;
  for (const line of out.split('\n')) {
    const m = line.match(/^\s*(\d+):\s*(\d+)x(\d+)\+(\d+)\+(\d+)\s+[\d.]+,[\d.]+\s+(\d+)/);
    if (!m) continue;
    const area = Number(m[6]);
    if (!best || area > best.area) {
      best = { w: Number(m[2]), h: Number(m[3]), x: Number(m[4]), y: Number(m[5]), area };
    }
  }
  return best;
}

function autoCrop(body) {
  const head = Math.round(body.w * 1.15);
  return {
    w: head,
    h: head,
    x: Math.round(body.x + body.w / 2 - head / 2),
    y: Math.max(0, body.y + Math.round(body.h * 0.02)),
  };
}

function trimBox(file) {
  const mask = path.join(TMP, 'trim-mask.png');
  magick([file, '-alpha', 'extract', '-threshold', '50%', mask]);
  const trimmed = path.join(TMP, 'trim-mask-t.png');
  magick([mask, '-trim', '+repage', trimmed]);
  const g = info(['-format', '%wx%h', trimmed]);
  const m = g.match(/(\d+)x(\d+)/);
  if (!m) throw new Error(`无法计算裁切范围: ${g}`);
  return { w: Number(m[1]), h: Number(m[2]), x: 0, y: 0 };
}

function build(catName, kind) {
  const src = path.join(RAW, `${catName}-${kind}.png`);
  if (!fs.existsSync(src)) {
    console.log(`  跳过 ${catName}-${kind}.png（文件不存在）`);
    return null;
  }
  const dims = info(['-format', '%wx%h %[channels]', src]);
  if (!/srgba|rgba/.test(dims)) {
    throw new Error(`${catName}-${kind}.png 缺少透明通道（${dims}），请重新生成`);
  }

  const cfg = CAT_CONFIG[catName];
  let crop = cfg.crop;
  if (!crop) {
    const body = detectBody(src);
    if (!body) throw new Error(`${catName}-${kind}.png 未找到主体`);
    crop = autoCrop(body);
  }

  const step1 = path.join(TMP, `${catName}-${kind}-crop.png`);
  magick([src, '-crop', `${crop.w}x${crop.h}+${crop.x}+${crop.y}`, '+repage', step1]);

  const t = trimBox(step1);
  const step2 = path.join(TMP, `${catName}-${kind}-trim.png`);
  magick([step1, '-crop', `${t.w}x${t.h}+${t.x}+${t.y}`, '+repage', step2]);

  const inner = Math.round(SIZE * (1 - 2 * PAD_RATIO));
  const step3 = path.join(TMP, `${catName}-${kind}-fit.png`);
  magick([step2, '-resize', `${inner}x${inner}`, step3]);

  const dest = path.join(OUT, `${cfg.out}-${kind}.png`);
  magick(['-size', `${SIZE}x${SIZE}`, 'xc:none', step3, '-gravity', 'center', '-composite', dest]);
  return dest;
}

function main() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(TMP, { recursive: true });
  const manifest = { size: SIZE, cats: [] };
  for (const [catName, cfg] of Object.entries(CAT_CONFIG)) {
    console.log(`${catName} → ${cfg.out}`);
    const open = build(catName, 'open');
    const closed = build(catName, 'closed');
    if (open && closed) {
      manifest.cats.push({ id: cfg.out, open: `${cfg.out}-open.png`, closed: `${cfg.out}-closed.png` });
    }
  }
  fs.writeFileSync(path.join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\n成品输出: ${OUT}`);
  console.log(`猫数量: ${manifest.cats.length}`);
}

main();