import { readFileSync, writeFileSync } from 'node:fs';

const mode = process.argv[2];
if (!['--bump-patch', '--sync-manifest', '--from-package'].includes(mode)) {
  throw new Error('Use --bump-patch, --sync-manifest, or --from-package');
}

const files = ['manifest.json', 'manifest-beta.json', 'package.json', 'package-lock.json', 'versions.json'];
const values = files.map(file => JSON.parse(readFileSync(file, 'utf8')));
const [manifest, beta, pkg, lock, versions] = values;
let version = mode === '--from-package' ? pkg.version : manifest.version;
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
  throw new Error('Version must use x.y.z format');
}
if (mode === '--bump-patch') {
  const [major, minor, patch] = version.split('.');
  version = `${major}.${minor}.${BigInt(patch) + 1n}`;
}
if (!lock.packages?.['']) throw new Error('Missing root package in package-lock.json');

// 稳定清单、beta 清单及兼容表保持一致，避免客户端拿到错配的版本。
manifest.version = beta.version = pkg.version = lock.version = lock.packages[''].version = version;
beta.minAppVersion = manifest.minAppVersion;
versions[version] = manifest.minAppVersion;
for (const [index, file] of files.entries()) {
  const json = `${JSON.stringify(values[index], null, 2)}\n`;
  const original = readFileSync(file, 'utf8');
  if (original.replace(/\r\n/g, '\n').trimEnd() !== json.trimEnd()) writeFileSync(file, json);
}
console.log(`Prepared version ${version}`);
