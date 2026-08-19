const fs = require('fs');
const path = require('path');

const sdkDir = process.argv[2] || process.env.SDK_DIR;
if (!sdkDir) {
  console.error('Usage: node scripts/install-vendor.js <sdk-dir>');
  process.exit(1);
}

const files = [
  'ableton-extensions-sdk-1.0.0-beta.0.tgz',
  'ableton-extensions-cli-1.0.0-beta.0.tgz',
];

for (const f of files) {
  const src = path.join(sdkDir, f);
  const dest = path.join(process.cwd(), 'vendor', f);
  if (!fs.existsSync(src)) {
    console.error(`Missing ${src}. Please verify your SDK directory or copy the file manually.`);
    process.exit(2);
  }
  fs.copyFileSync(src, dest);
  console.log(`Copied ${f} -> vendor/${f}`);
}

console.log('Vendor files installed. Run `npm install` to install dependencies.');
