import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'public/social');
const copy = {
  pt: { lines: ['Maio no digital,', 'ao alcance', 'de todos.'] },
  en: { lines: ['Digital Maio,', 'within', 'everyone’s reach.'] },
  fr: { lines: ['Maio numérique,', 'à la portée', 'de tous.'] },
};
await mkdir(output, { recursive: true });
const photo = await sharp(path.join(root, 'public/maioCover.png'))
  .resize(448, 542, { fit: 'cover', position: 'centre' })
  .composite([{ input: Buffer.from('<svg width="448" height="542"><rect width="448" height="542" rx="28" fill="white"/></svg>'), blend: 'dest-in' }])
  .png().toBuffer();
for (const [locale, text] of Object.entries(copy)) {
  const textSvg = `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
    <rect width="1200" height="630" fill="#fbfbf8"/>
    <g font-family="Helvetica, Arial, sans-serif">
      <text x="52" y="89" font-size="43" font-weight="600" fill="#171a16">maio.cv</text>
      ${text.lines.map((line, i) => `<text x="52" y="${229 + i * 77}" font-size="${locale === 'en' && i === 2 ? 59 : 64}" letter-spacing="-2" font-weight="500" fill="#171a16">${line}</text>`).join('')}
    </g>
  </svg>`;
  await sharp(Buffer.from(textSvg))
    .composite([{ input: photo, left: 708, top: 44 }])
    .png({ palette: true, quality: 95, effort: 10 })
    .toFile(path.join(output, `maio-${locale}.png`));
}
