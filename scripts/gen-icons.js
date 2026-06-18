// scripts/gen-icons.js  (run once: node scripts/gen-icons.js)
const { createCanvas } = require('canvas');
const fs = require('fs');

function makeIcon(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#22c55e';
  ctx.shadowColor = 'rgba(34,197,94,0.6)';
  ctx.shadowBlur = size * 0.15;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.3, 0, Math.PI * 2);
  ctx.fill();
  return canvas.toBuffer('image/png');
}

fs.mkdirSync('icons', { recursive: true });
fs.writeFileSync('icons/icon-180.png', makeIcon(180)); // canonical iOS apple-touch-icon size
fs.writeFileSync('icons/icon-192.png', makeIcon(192));
fs.writeFileSync('icons/icon-512.png', makeIcon(512));
console.log('Icons created.');
