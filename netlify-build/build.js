'use strict';
// Rebuilds the original public/ folder layout into site/ for Netlify, since the repo stores every file flat in the root.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'site');

const files = {
  'js': ['admin.js', 'boot.js', 'core.js', 'diag.js', 'i18n.js', 'pay.js', 'slider.js', 'store.js'],
  'css': ['admin.css', 'store.css', 'theme.css'],
  'vendor/bootstrap': ['bootstrap.bundle.min.js', 'bootstrap.min.css', 'bootstrap.rtl.min.css'],
  'pages': fs.readdirSync(ROOT).filter((f) => /^(home-hero|home-extra|about)(\.(ar|en))?\.html$/.test(f) || /^[a-z0-9-]+\.(ar|en)\.html$/.test(f)),
};

fs.rmSync(OUT, { recursive: true, force: true });
const copy = (src, dest) => { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.copyFileSync(src, dest); };

for (const [dir, list] of Object.entries(files)) for (const f of list) copy(path.join(ROOT, f), path.join(OUT, dir, f));
copy(path.join(ROOT, 'index.html'), path.join(OUT, 'admin/index.html')); // the root index.html is the admin dashboard
copy(path.join(ROOT, 'pay.html'), path.join(OUT, 'pay.html'));
copy(path.join(__dirname, 'store-index.html'), path.join(OUT, 'index.html'));

console.log('Static site written to site/');
