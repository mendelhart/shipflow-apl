/**
 * TJX Europe letterhead images.
 *
 * These were hot-linked from media.base44.com — the platform this app was
 * migrated OFF. They appear on the Food Data Checklist and on every emailed
 * commercial invoice, i.e. on documents that go to TJX. Whenever Base44 stops
 * serving them, those documents start going out with broken images and nothing
 * in this app would know.
 *
 * They are now served from this app's own /public. The remote URL is kept only
 * as a fallback so nothing breaks in the window between deploying this change
 * and the PNGs landing in the repo; delete REMOTE_* once they are in.
 */

export const HEADER_IMG = '/tjx-header.png';
export const FOOTER_IMG = '/tjx-footer.png';

const REMOTE_HEADER = 'https://media.base44.com/images/public/69b77fe17f63d9da1603f490/4586c1ce5_HeaderTJX.png';
const REMOTE_FOOTER = 'https://media.base44.com/images/public/69b77fe17f63d9da1603f490/16f51c542_FooterTJX1.png';

export const HEADER_FALLBACK = REMOTE_HEADER;
export const FOOTER_FALLBACK = REMOTE_FOOTER;

/**
 * Fetch an image as a data URL, trying the local copy first.
 * Returns null rather than throwing: a missing letterhead should not stop an
 * invoice being produced, and the caller already lays out without it.
 */
export async function loadBrandImage(local, fallback) {
  for (const url of [local, fallback]) {
    if (!url) continue;
    try {
      const resp = await fetch(url);
      if (!resp.ok) continue;
      const blob = await resp.blob();
      if (!blob.type.startsWith('image/')) continue;
      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch {
      // try the next source
    }
  }
  console.error('Letterhead images unavailable; document will render without them.');
  return null;
}
