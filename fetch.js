// Temporary gofile fetcher for GitHub Actions (Task 11).
// Usage: node fetch.js <contentId>
// Creates a guest account, signs requests with wt.obf.js evaluated in a VM,
// lists the content and downloads every file into out/.
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const LANG = 'en-US';

function stubs() {
  const s = {
    console: { log: () => {}, warn: () => {}, error: () => {} },
    navigator: { userAgent: UA, language: LANG, languages: [LANG] },
    location: { href: 'https://gofile.io/', protocol: 'https:', hostname: 'gofile.io', origin: 'https://gofile.io' },
    document: {
      cookie: '',
      createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }),
      head: { appendChild() {} },
      documentElement: {},
    },
    performance: { timeOrigin: Date.now(), now: () => Date.now() % 1e6 },
    crypto: globalThis.crypto,
    TextEncoder, TextDecoder, Date, Math, JSON, Promise, Uint8Array, ArrayBuffer,
  };
  s.window = s; s.self = s; s.globalThis = s; s.top = s; s.parent = s;
  return s;
}

async function main() {
  const contentId = process.argv[2] || 'jEeLaEYi';
  fs.mkdirSync('out', { recursive: true });

  // 1) guest account
  let r = await fetch('https://api.gofile.io/accounts', { method: 'POST', headers: { 'User-Agent': UA } });
  let j = await r.json();
  if (!j || j.status !== 'ok' || !j.data || !j.data.token) throw new Error('guest: ' + JSON.stringify(j).slice(0, 200));
  const tok = j.data.token;
  console.log('guest token ok:', tok.slice(0, 6) + '...');

  // 2) website token via wt.obf.js in VM
  const wtRes = await fetch('https://gofile.io/js/wt.obf.js', { headers: { 'User-Agent': UA } });
  if (!wtRes.ok) throw new Error('wt.obf.js HTTP ' + wtRes.status);
  const wtSrc = await wtRes.text();
  fs.writeFileSync('out/_wt_obf.js', wtSrc);
  const sb = stubs();
  vm.createContext(sb);
  vm.runInContext(wtSrc, sb, { timeout: 15000 });
  const gen = sb.generateWT || sb.window.generateWT;
  if (typeof gen !== 'function') throw new Error('generateWT missing after eval');
  const wt = await gen(tok);
  console.log('wt ok:', String(wt).slice(0, 10) + '...');

  // 3) contents listing
  const cu = 'https://api.gofile.io/contents/' + encodeURIComponent(contentId) +
    '?page=1&pageSize=1000&sortField=name&sortDirection=1';
  const cr = await fetch(cu, {
    headers: {
      'User-Agent': UA,
      'Authorization': 'Bearer ' + tok,
      'X-Website-Token': String(wt),
      'X-BL': LANG,
      'Origin': 'https://gofile.io',
      'Referer': 'https://gofile.io/',
    },
  });
  const cj = await cr.json();
  fs.writeFileSync('out/_contents.json', JSON.stringify(cj, null, 2));
  console.log('contents status:', cj.status);
  if (cj.status !== 'ok') throw new Error('contents failed: ' + cj.status);

  // 4) collect files (walk children)
  const files = [];
  (function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'file' && node.link) files.push(node);
    const ch = node.children;
    if (Array.isArray(ch)) ch.forEach(walk);
    else if (ch && typeof ch === 'object') Object.values(ch).forEach(walk);
  })(cj.data);
  console.log('files found:', files.length);
  files.forEach(f => console.log(' -', f.name, f.size, f.mimetype || ''));

  // 5) download each
  for (const f of files) {
    const dest = path.join('out', f.name.replace(/[^\w.\-]+/g, '_'));
    const dr = await fetch(f.link, { headers: { 'User-Agent': UA, 'Cookie': 'accountToken=' + tok } });
    if (!dr.ok) { console.error('download failed', f.name, dr.status); continue; }
    const buf = Buffer.from(await dr.arrayBuffer());
    fs.writeFileSync(dest, buf);
    console.log('saved', dest, buf.length);
  }
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
