import React from 'react';
import { Button } from '@/components/ui/button';
import { AlertTriangle, RefreshCw } from 'lucide-react';

/**
 * Catches render-time errors and failed lazy-chunk loads.
 *
 * Without this, two routine events blank the whole app:
 *
 *  1. A deploy. Every page is React.lazy, so the running tab still holds the
 *     previous build's hashed chunk URLs. Those 404 after a deploy, the
 *     dynamic import rejects, and <Suspense> does not catch rejections.
 *  2. Any throw during render — e.g. date-fns `format()` on an unparseable
 *     date from one bad row.
 *
 * A stale-chunk error is self-healing, so we reload once automatically
 * rather than showing the user an error they can do nothing with.
 */
const CHUNK_ERROR = /Loading chunk|Failed to fetch dynamically imported module|Importing a module script failed/i;
const RELOAD_FLAG = 'shipflow:chunk-reload';

export default class ErrorBoundary extends React.Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // The only telemetry this app has. Keep the component stack — it is what
    // identifies which of the 1000-line pages threw.
    console.error('[ErrorBoundary]', error, info?.componentStack);

    if (CHUNK_ERROR.test(error?.message ?? '')) {
      // Reload once. The flag stops a reload loop if the chunk is genuinely
      // missing rather than merely stale.
      if (!sessionStorage.getItem(RELOAD_FLAG)) {
        sessionStorage.setItem(RELOAD_FLAG, '1');
        window.location.reload();
      }
    } else {
      sessionStorage.removeItem(RELOAD_FLAG);
    }
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const isStale = CHUNK_ERROR.test(error?.message ?? '');

    return (
      <div className="fixed inset-0 flex items-center justify-center bg-slate-50 p-6">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-xl shadow-sm p-8 text-center">
          <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto" />
          <h1 className="mt-4 text-lg font-semibold text-slate-900">
            {isStale ? 'A new version is available' : 'Something went wrong'}
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            {isStale
              ? 'The app was updated while this tab was open. Reload to get the latest version.'
              : 'This page hit an unexpected error. Your saved data is unaffected.'}
          </p>
          <Button className="mt-6 w-full" onClick={() => window.location.reload()}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Reload
          </Button>
          {!isStale && (
            <details className="mt-4 text-left">
              <summary className="text-xs text-slate-500 cursor-pointer">
                Technical details
              </summary>
              <pre className="mt-2 text-[11px] text-slate-600 whitespace-pre-wrap break-words max-h-40 overflow-auto">
                {error?.message}
              </pre>
            </details>
          )}
        </div>
      </div>
    );
  }
}
