/**
 * Minimal resolver so Node can import app modules that use Vite's "@/" alias.
 *
 * Without it, anything importing "@/domain/..." is untestable outside a bundler,
 * which is how the adapter ended up with a test harness that regex-rewrote and
 * eval'd source text instead of importing it.
 */
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('./alias-resolver.mjs', pathToFileURL(new URL('.', import.meta.url).pathname));
