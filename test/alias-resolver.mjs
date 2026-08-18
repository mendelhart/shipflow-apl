import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = new URL('../src/', import.meta.url);
const EXTS = ['', '.js', '.jsx', '.mjs', '/index.js', '/index.jsx'];

/**
 * Resolves Vite's "@/" alias and its extensionless imports, which Node does
 * not do natively. Without this, app modules can only be loaded by a bundler
 * and therefore cannot be unit-tested.
 */
export function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const base = new URL(specifier.slice(2), SRC);
    for (const ext of EXTS) {
      const candidate = new URL(base.href + ext);
      if (existsSync(fileURLToPath(candidate))) {
        return nextResolve(candidate.href, context);
      }
    }
    return nextResolve(base.href, context);
  }
  return nextResolve(specifier, context);
}
