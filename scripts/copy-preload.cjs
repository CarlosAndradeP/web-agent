const fs = require('fs');
const path = require('path');

const src = path.join('src', 'preload', 'port-force.cjs');
const dest = path.join('dist', 'preload', 'port-force.cjs');

fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.copyFileSync(src, dest);
console.log('Copied', src, '→', dest);
