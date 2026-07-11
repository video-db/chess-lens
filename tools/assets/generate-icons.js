#!/usr/bin/env node
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const os = require('os');

const RESOURCES = path.join(__dirname, '..', '..', 'resources');

const ORANGE_SVG = path.join(RESOURCES, 'chess-lens-icon-orange.svg');
const BLACK_SVG = path.join(RESOURCES, 'chess-lens-icon-black.svg');

// Sizes needed for each format
const ICNS_SIZES = [16, 32, 48, 128, 256, 512, 1024];
const ICO_SIZES = [16, 32, 48, 64, 256];
const TRAY_SIZE = 24;

/**
 * Build a binary .icns file from PNG buffers at various sizes.
 */
function buildIcns(pngsBySize) {
  const entries = [];

  const TYPE_MAP = {
    16:   { type: 'icp5' },
    32:   { type: 'icp6' },
    128:  { type: 'ic07' },
    256:  { type: 'ic08' },
    512:  { type: 'ic09' },
    1024: { type: 'ic10' },
  };

  for (const [s, png] of Object.entries(pngsBySize)) {
    const size = Number(s);
    if (!TYPE_MAP[size]) continue;
    const { type } = TYPE_MAP[size];
    const entryHeader = Buffer.alloc(8);
    entryHeader.write(type, 0, 4, 'ascii');
    entryHeader.writeUInt32BE(8 + png.length, 4);
    entries.push(Buffer.concat([entryHeader, png]));
  }

  const totalSize = 8 + entries.reduce((sum, e) => sum + e.length, 0);
  const header = Buffer.alloc(8);
  header.write('icns', 0, 4, 'ascii');
  header.writeUInt32BE(totalSize, 4);

  return Buffer.concat([header, ...entries]);
}

async function main() {
  console.log('Generating Chess Lens icons...\n');

  // Generate PNGs at all required sizes from orange SVG
  const pngs = {};
  const allSizes = new Set([...ICNS_SIZES, ...ICO_SIZES, TRAY_SIZE]);
  for (const size of allSizes) {
    const buf = await sharp(ORANGE_SVG)
      .resize(size, size)
      .png()
      .toBuffer();
    pngs[size] = buf;
    console.log(`  Generated ${size}x${size} PNG`);
  }

  // --- icon.icns ---
  const icnsData = buildIcns(pngs);
  const icnsPath = path.join(RESOURCES, 'icon.icns');
  fs.writeFileSync(icnsPath, icnsData);
  console.log(`\n  Wrote icon.icns (${(icnsData.length / 1024).toFixed(0)} KB)`);

  // --- icon.ico (png-to-ico is ESM, use dynamic import) ---
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chess-icons-'));
  const icoPngPaths = [];
  for (const s of ICO_SIZES) {
    const tmpPng = path.join(tmpDir, `${s}.png`);
    fs.writeFileSync(tmpPng, pngs[s]);
    icoPngPaths.push(tmpPng);
  }
  const { default: pngToIco } = await import('png-to-ico');
  const icoData = await pngToIco(icoPngPaths);
  const icoPath = path.join(RESOURCES, 'icon.ico');
  fs.writeFileSync(icoPath, icoData);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log(`  Wrote icon.ico (${(icoData.length / 1024).toFixed(0)} KB)`);

  // --- Tray icon (icon-color-black-bg.png) ---
  const trayBuf = await sharp(BLACK_SVG)
    .resize(TRAY_SIZE, TRAY_SIZE)
    .png()
    .toBuffer();
  fs.writeFileSync(path.join(RESOURCES, 'icon-color-black-bg.png'), trayBuf);
  console.log(`  Wrote icon-color-black-bg.png (${(trayBuf.length / 1024).toFixed(1)} KB)`);

  // --- Regenerate all icon PNG variants ---
  const ICON_VARIANTS = [
    { name: 'icon-color', svg: ORANGE_SVG, size: 64 },
    { name: 'icon-color-light', svg: ORANGE_SVG, size: 256 },
    { name: 'icon-color-black-bg', svg: BLACK_SVG, size: 64 },
    { name: 'icon-mono-black-bg', svg: BLACK_SVG, size: 64 },
    { name: 'icon-mono-orange-bg', svg: ORANGE_SVG, size: 64 },
  ];
  for (const v of ICON_VARIANTS) {
    const buf = await sharp(v.svg)
      .resize(v.size, v.size)
      .png()
      .toBuffer();
    fs.writeFileSync(path.join(RESOURCES, `${v.name}.png`), buf);
    console.log(`  Updated ${v.name}.png (${v.size}x${v.size})`);
  }

  console.log('\nDone! All icons generated.');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
