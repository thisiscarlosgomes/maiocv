import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'public/social');
const copy = {
  pt: { lines: ['Maio no digital,', 'ao alcance', 'de todos.'], topics: 'Lugares · Dados · Conversas', place: 'Ilha do Maio · Cabo Verde' },
  en: { lines: ['Digital Maio,', 'within', 'everyone’s reach.'], topics: 'Places · Data · Conversations', place: 'Maio island · Cabo Verde' },
  fr: { lines: ['Maio numérique,', 'à la portée', 'de tous.'], topics: 'Lieux · Données · Conversations', place: 'Île de Maio · Cap-Vert' },
};
await mkdir(output, { recursive: true });
const photo = await sharp(path.join(root, 'public/maioCover.png'))
  .resize(448, 542, { fit: 'cover', position: 'centre' })
  .composite([{ input: Buffer.from('<svg width="448" height="542"><rect width="448" height="542" rx="28" fill="white"/></svg>'), blend: 'dest-in' }])
  .png().toBuffer();
for (const [locale, text] of Object.entries(copy)) {
  const textSvg = `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
    <rect width="1200" height="630" fill="#fbfbf8"/>
    <rect x="52" y="48" width="52" height="52" rx="12" fill="#243fb8"/>
    <path d="M64 85V62h6l8 11 8-11h6v23h-6V72l-8 11-8-11v13z" fill="#fbfbf8"/>
    <g font-family="Helvetica, Arial, sans-serif">
      <text x="121" y="89" font-size="43" font-weight="600" fill="#171a16">maio.cv</text>
      ${text.lines.map((line, i) => `<text x="52" y="${229 + i * 77}" font-size="${locale === 'en' && i === 2 ? 59 : 64}" letter-spacing="-2" font-weight="500" fill="#171a16">${line}</text>`).join('')}
      <text x="54" y="479" font-size="23" fill="#243fb8">${text.topics}</text>
      <text x="54" y="570" font-size="21" fill="#70796b">${text.place}</text>
    </g>
  </svg>`;
  await sharp(Buffer.from(textSvg))
    .composite([{ input: photo, left: 708, top: 44 }])
    .png({ palette: true, quality: 95, effort: 10 })
    .toFile(path.join(output, `maio-${locale}.png`));
}
