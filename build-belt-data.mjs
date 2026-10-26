import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

const input = 'Meshy_AI_Black_Belt_Resolve_1025162705_texture_fbx/Meshy_AI_Black_Belt_Resolve_1025162705_texture.fbx';
const output = 'assets/belt-model-data.js';
const raw = await readFile(input);
const compressed = gzipSync(raw, { level: 9 });
const base64 = compressed.toString('base64');
const chunks = base64.match(/.{1,16000}/g) || [];
const source = `/* Generated from the supplied FBX. Keep the source model alongside this file. */\nwindow.RANDORI_BELT_GZIP = [\n${chunks.map(chunk => `  '${chunk}'`).join(',\n')}\n].join('');\n`;
await mkdir('assets', { recursive: true });
await writeFile(output, source, 'utf8');
console.log(JSON.stringify({ originalBytes: raw.length, gzipBytes: compressed.length, embeddedBytes: Buffer.byteLength(source), chunks: chunks.length }));
