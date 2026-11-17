import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const publishedPath = process.argv[2];
if (!publishedPath) throw new Error('Usage: node scripts/compare-firestore-rules.mjs <exported-published-rules-file>');
const local = await readFile(new URL('../firestore.rules', import.meta.url), 'utf8');
const published = await readFile(publishedPath, 'utf8');
const normalize = value => value.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
const hash = value => createHash('sha256').update(normalize(value)).digest('hex');
console.log(`Local SHA-256: ${hash(local)}`);
console.log(`Published copy SHA-256: ${hash(published)}`);
if (normalize(local) !== normalize(published)) {
  console.error('DIFFERENT: review the source diff. Whitespace/comments may also differ.');
  process.exitCode = 1;
} else console.log('IDENTICAL (ignoring BOM and Windows line endings).');
