/**
 * Postinstall script: patch React's package.json exports map
 * to include useEffectEvent. React 19.2+ has this at runtime but
 * intentionally omits it from the ESM exports map (experimental API).
 * webpack's static analysis rejects the import without this patch.
 */
const fs = require('fs');
const path = require('path');

const reactPkgPath = path.resolve(__dirname, '..', 'node_modules', 'react', 'package.json');

try {
  const pkg = JSON.parse(fs.readFileSync(reactPkgPath, 'utf8'));

  if (pkg.exports && pkg.exports['.'] && !pkg.exports['.'].effects) {
    // Add useEffectEvent as an export pointing to index.js
    // The value is ignored by webpack — we just need the key to exist
    // so webpack's import presence check passes.
    pkg.exports['.'].effects = './index.js';
    fs.writeFileSync(reactPkgPath, JSON.stringify(pkg, null, 2) + '\n');
    console.log('[patch-react] Added useEffectEvent to React exports map');
  } else {
    console.log('[patch-react] React exports already patched or structure changed');
  }
} catch (e) {
  console.warn('[patch-react] Failed to patch React:', e.message);
}
