/**
 * Admin user management.
 *
 * WHY THIS EXISTS
 * Migration 002 closed the privilege-escalation hole — a signed-in user could
 * set their own role to admin — by revoking the update grant on `profiles` down
 * to `full_name` and adding a trigger. That was right, but it left no way
 * through: nothing in the app could set `is_active`, so activating a new
 * colleague meant opening the Supabase dashboard and editing a table by hand.
 * Every new member of staff would have gone through that.
 *
 * Migration 003 widens the grant and the policy; the trigger still decides who
 * may change role and is_active, and refuses to strip the last active admin.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ShieldCheck, ShieldOff, UserCheck, UserX, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { friendlyErrorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/dates';

export default function Users() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);

  const isAdmin = user?.role === 'admin';

  const { data: profiles = [], isLoading } = useQuery({
    queryKey: ['profiles'],
    queryFn: () => base44.auth.listProfiles('email'),
    enabled: isAdmin,
  });

  const save = useMutation({
    mutationFn: ({ id, patch }) => base44.auth.updateProfile(id, patch),
    onMutate: ({ id }) => { setBusyId(id); setError(''); },
    onSettled: () => setBusyId(null),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['profiles'] }),
    onError: (err) =>
      setError(
        friendlyErrorMessage(
          err,
          'Could not update that user. Only an admin can change roles and access.'
        )
      ),
  });

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="max-w-sm text-center">
          <ShieldOff className="w-8 h-8 mx-auto text-slate-400" />
          <h1 className="mt-3 text-lg font-semibold text-slate-900">Admins only</h1>
          <p className="mt-1 text-sm text-slate-500">
            Ask an administrator if you need access to user management.
          </p>
          <Link to="/Dashboard" className="mt-4 inline-block text-sm text-blue-600">
            Back to dashboard
          </Link>
        </div>
      </div>
    );
  }

  const q = search.trim().toLowerCase();
  const visible = profiles.filter(
    (p) =>
      !q ||
      String(p.email ?? '').toLowerCase().includes(q) ||
      String(p.full_name ?? '').toLowerCase().includes(q)
  );
  const pending = visible.filter((p) => !p.is_active);
  const active = visible.filter((p) => p.is_active);

  const Row = ({ p }) => {
    const isSelf = p.id === user?.id;
    const busy = busyId === p.id;
    return (
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3 last:border-0">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-slate-900">
            {p.full_name || p.email}
            {isSelf && <span className="ml-2 text-xs font-normal text-slate-400">(you)</span>}
          </div>
          <div className="truncate text-xs text-slate-500">{p.email}</div>
        </div>

        <div className="text-xs text-slate-400 w-28 hidden sm:block">
          joined {formatDate(p.created_date, 'd MMM yyyy', '—')}
        </div>

        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            p.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-slate-100 text-slate-600'
          }`}
        >
          {p.role === 'admin' ? 'Admin' : 'User'}
        </span>

        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => save.mutate({ id: p.id, patch: { role: p.role === 'admin' ? 'user' : 'admin' } })}
        >
          {p.role === 'admin' ? <ShieldOff className="w-3.5 h-3.5 mr-1" /> : <ShieldCheck className="w-3.5 h-3.5 mr-1" />}
          {p.role === 'admin' ? 'Remove admin' : 'Make admin'}
        </Button>

        <Button
          size="sm"
          variant={p.is_active ? 'outline' : 'default'}
          disabled={busy}
          onClick={() => save.mutate({ id: p.id, patch: { is_active: !p.is_active } })}
        >
          {p.is_active ? <UserX className="w-3.5 h-3.5 mr-1" /> : <UserCheck className="w-3.5 h-3.5 mr-1" />}
          {p.is_active ? 'Deactivate' : 'Activate'}
        </Button>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b px-6 py-4 flex items-center gap-4">
        <Link to="/Dashboard" className="text-gray-500 hover:text-gray-800">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-gray-900">Users</h1>
          <p className="text-xs text-gray-500">
            Anyone with a @capitalnutrition.ca address is activated automatically on first
            sign-in. Everyone else waits here until you activate them.
          </p>
        </div>
      </div>

      <div className="p-6 max-w-4xl mx-auto space-y-5">
        {error && (
          <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            className="pl-9"
            placeholder="Search by name or email"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {isLoading && <div className="text-sm text-slate-400">Loading…</div>}

        {!isLoading && pending.length > 0 && (
          <div className="rounded-xl border border-amber-200 bg-white">
            <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-900">
              Waiting for access ({pending.length})
            </div>
            {pending.map((p) => <Row key={p.id} p={p} />)}
          </div>
        )}

        {!isLoading && (
          <div className="rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-4 py-2 text-sm font-medium text-slate-700">
              Active ({active.length})
            </div>
            {active.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-slate-400">No active users match that search.</div>
            ) : (
              active.map((p) => <Row key={p.id} p={p} />)
            )}
          </div>
        )}
      </div>
    </div>
  );
}
