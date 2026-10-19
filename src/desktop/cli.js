#!/usr/bin/env node
// Command-line front end for the conversion engine.
//   node src/desktop/cli.js <file> --list            show what the file can become
//   node src/desktop/cli.js <file> <format> [--out dir]
//   node src/desktop/cli.js <file...> --tool <id> [--out dir]

import path from 'node:path';
import { createEngine } from './convert/index.js';
import { labelOf, formatOf } from '../shared/formats.js';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const has = (name) => {
  const i = args.indexOf(name);
  if (i >= 0) args.splice(i, 1);
  return i >= 0;
};

const outDir = flag('--out');
const toolId = flag('--tool');
const list = has('--list');
const noOffice = has('--no-office');

if (!args.length) {
  console.log('Usage: easy-convert <file> <format> | <file> --list | <files...> --tool <id>');
  process.exit(1);
}

const engine = await createEngine({ useOffice: !noOffice });
const progress = ({ fraction, label }) => process.stderr.write(`\r  ${Math.round(fraction * 100)}% ${label}`.padEnd(60));

try {
  if (list) {
    const files = args.map((f) => path.resolve(f));
    const { targets, tools, unsupported } = engine.optionsFor(files);
    if (unsupported?.length) throw new Error(`Unsupported: ${unsupported.join(', ')}`);
    console.log('Office:', JSON.stringify(engine.office));
    console.log('Convert to:');
    for (const t of targets) console.log(`  ${labelOf(t).padEnd(6)} ${engine.explain(formatOf(files[0]), t)}`);
    console.log('Tools:', tools.join(', '));
  } else if (toolId) {
    const out = await engine.tool(toolId, args.map((f) => path.resolve(f)), { outDir, progress });
    process.stderr.write('\n');
    out.forEach((f) => console.log(f));
  } else {
    const [file, target] = args;
    const out = await engine.convert(path.resolve(file), formatOf(target) ?? target, { outDir, progress });
    process.stderr.write('\n');
    out.forEach((f) => console.log(f));
  }
} catch (e) {
  process.stderr.write('\n');
  console.error('Error:', e.message);
  process.exit(1);
}
