/**
 * Login page. Base44 hosted this for us; on the new stack it's ours.
 * Google OAuth + magic link, both free on Supabase Auth.
 */
import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { base44, supabase } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';

export default function Login() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const next = params.get('next') || '/Dashboard';

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) navigate(next, { replace: true });
    });
  }, [navigate, next]);

  const withBusy = async (fn) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e.message || 'Sign-in failed. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const signInWithGoogle = () =>
    withBusy(async () => {
      const { error: e } = await base44.auth.signInWithGoogle(
        `${window.location.origin}${next}`
      );
      if (e) throw e;
    });

  const sendMagicLink = (event) => {
    event.preventDefault();
    return withBusy(async () => {
      const { error: e } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: `${window.location.origin}${next}` },
      });
      if (e) throw e;
      setSent(true);
    });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm bg-white rounded-xl shadow-sm border border-slate-200 p-8">
        <h1 className="text-xl font-semibold text-slate-900 text-center">Shipping Hub</h1>
        <p className="mt-1 text-sm text-slate-500 text-center">Sign in to continue</p>

        <Button
          type="button"
          onClick={signInWithGoogle}
          disabled={busy}
          className="w-full mt-6"
          variant="outline"
        >
          {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
          Continue with Google
        </Button>

        <div className="flex items-center gap-3 my-6">
          <div className="h-px flex-1 bg-slate-200" />
          <span className="text-xs text-slate-400">or</span>
          <div className="h-px flex-1 bg-slate-200" />
        </div>

        {sent ? (
          <p className="text-sm text-center text-slate-600">
            Check <span className="font-medium">{email}</span> for a sign-in link.
          </p>
        ) : (
          <form onSubmit={sendMagicLink} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
              />
            </div>
            <Button type="submit" disabled={busy || !email.trim()} className="w-full">
              {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Email me a sign-in link
            </Button>
          </form>
        )}

        {error ? (
          <p role="alert" className="mt-4 text-sm text-red-600 text-center">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
