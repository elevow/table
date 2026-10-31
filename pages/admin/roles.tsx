import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { authHeaders } from '../../src/utils/auth-headers';
import type { LimitDef, PermissionGroup } from '../../src/lib/auth/permissions';

interface LimitValue {
  key: string;
  /** null means no limit */
  value: number | null;
}

interface Role {
  id: string;
  key: string;
  name: string;
  description: string | null;
  rank: number;
  built_in: boolean;
  permissions: string[];
  limits: LimitValue[];
  member_count: number;
}

interface Override {
  permission: string;
  effect: 'grant' | 'deny';
  reason: string | null;
}

interface Sanction {
  kind: 'ban' | 'suspend';
  until: string | null;
  reason: string | null;
}

interface AdminUser {
  id: string;
  email: string;
  username: string;
  roles: string[];
  overrides: Override[];
  limits: (LimitValue & { reason: string | null })[];
  sanction: Sanction | null;
  bootstrapAdmin: boolean;
}

interface Me {
  rank: number;
  bootstrapAdmin: boolean;
  permissions: string[];
}

interface AuditEntry {
  id: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
  actor_username: string | null;
  actor_email: string | null;
}

type Tab = 'roles' | 'users' | 'audit';

const IMPLICIT_ROLES = ['guest', 'player'];
const LOCKED_ROLES = ['super_admin'];
const NO_LIMIT = '∞';

/** A limit as typed: '' (not set), '∞' (no limit) or a whole number. */
function limitText(value: number | null | undefined): string {
  return value === undefined ? '' : value === null ? NO_LIMIT : String(value);
}

/** Parses typed limit text: undefined when blank, null for no limit, or false when invalid. */
function parseLimitText(text: string): number | null | undefined | false {
  const t = text.trim().toLowerCase();
  if (!t) return undefined;
  if (t === NO_LIMIT || t === 'none' || t === 'unlimited') return null;
  return /^\d{1,7}$/.test(t) ? Number(t) : false;
}

/** The most generous limit among roles, as the server resolves it (undefined when none set it). */
function rolesLimit(roles: Role[], key: string): number | null | undefined {
  let result: number | null | undefined;
  for (const role of roles) {
    const l = role.limits.find(x => x.key === key);
    if (!l) continue;
    if (result === undefined) result = l.value;
    else if (result !== null) result = l.value === null ? null : Math.max(result, l.value);
  }
  return result;
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...(init?.headers || {}) },
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401) throw new Error('Sign in to manage roles.');
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json as T;
}

export default function AdminRolesPage() {
  const [tab, setTab] = useState<Tab>('roles');
  const [roles, setRoles] = useState<Role[]>([]);
  const [groups, setGroups] = useState<PermissionGroup[]>([]);
  const [limitDefs, setLimitDefs] = useState<LimitDef[]>([]);
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadRoles = useCallback(async () => {
    try {
      const data = await api<{ roles: Role[]; groups: PermissionGroup[]; limitDefs: LimitDef[]; me: Me }>('/api/admin/roles');
      setRoles(data.roles.map(r => ({ ...r, limits: r.limits ?? [] })));
      setGroups(data.groups);
      setLimitDefs(data.limitDefs ?? []);
      setMe(data.me);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadRoles(); }, [loadRoles]);

  const can = useCallback((p: string) => !!me?.permissions.includes(p), [me]);
  const canManageRank = useCallback((rank: number) => !!me && (me.bootstrapAdmin || rank <= me.rank), [me]);

  const flash = (text: string) => {
    setMessage(text);
    setError(null);
    setTimeout(() => setMessage(m => (m === text ? null : m)), 4000);
  };

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900">
      <header className="bg-white dark:bg-gray-800 shadow-sm">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center">
            <span className="bg-red-500 text-white px-2 py-1 rounded text-sm mr-3">ADMIN</span>
            Roles &amp; permissions
          </h1>
          <Link href="/dashboard" className="text-blue-600 dark:text-blue-400 hover:underline text-sm">
            Back to dashboard
          </Link>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6">
        <nav className="flex gap-2 mb-4" role="tablist">
          {(['roles', 'users', 'audit'] as Tab[])
            .filter(t => t !== 'audit' || can('admin.audit_log.view'))
            .map(t => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={`px-4 py-2 rounded-md text-sm font-medium ${
                  tab === t
                    ? 'bg-indigo-500 text-white'
                    : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700'
                }`}
              >
                {t === 'roles' ? 'Roles' : t === 'users' ? 'Users' : 'Audit log'}
              </button>
            ))}
        </nav>

        {message && <div className="mb-4 p-3 bg-green-100 border border-green-400 text-green-700 rounded">{message}</div>}
        {error && <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">{error}</div>}

        {loading ? (
          <p className="text-gray-600 dark:text-gray-300">Loading…</p>
        ) : !me ? null : tab === 'roles' ? (
          <RolesTab
            roles={roles}
            groups={groups}
            limitDefs={limitDefs}
            canEdit={can('roles.edit')}
            canManageRank={canManageRank}
            myPermissions={me.bootstrapAdmin ? null : new Set(me.permissions)}
            onSaved={async text => { await loadRoles(); flash(text); }}
            onError={setError}
          />
        ) : tab === 'users' ? (
          <UsersTab
            roles={roles}
            groups={groups}
            limitDefs={limitDefs}
            canAssign={can('roles.assign')}
            canManageRank={canManageRank}
            me={me}
            onSaved={async text => { await loadRoles(); flash(text); }}
            onError={setError}
          />
        ) : (
          <AuditTab onError={setError} />
        )}
      </main>
    </div>
  );
}

function RolesTab({
  roles, groups, limitDefs, canEdit, canManageRank, myPermissions, onSaved, onError,
}: {
  roles: Role[];
  groups: PermissionGroup[];
  limitDefs: LimitDef[];
  canEdit: boolean;
  canManageRank: (rank: number) => boolean;
  /** null when the viewer holds every permission */
  myPermissions: Set<string> | null;
  onSaved: (message: string) => Promise<void>;
  onError: (message: string) => void;
}) {
  // Pending permission sets for roles with unsaved edits
  const [drafts, setDrafts] = useState<Record<string, Set<string>>>({});
  // Pending limit text by role, then by limit key
  const [limitDrafts, setLimitDrafts] = useState<Record<string, Record<string, string>>>({});
  const [saving, setSaving] = useState(false);
  const [newRole, setNewRole] = useState({ name: '', rank: 15, description: '' });

  useEffect(() => { setDrafts({}); setLimitDrafts({}); }, [roles]);

  const editable = (role: Role) => canEdit && canManageRank(role.rank) && !LOCKED_ROLES.includes(role.key);
  const limitsEditable = (role: Role) => canEdit && canManageRank(role.rank);
  const savedLimitText = (role: Role, key: string) => limitText(role.limits.find(l => l.key === key)?.value);
  const limitDraft = (role: Role, key: string) => limitDrafts[role.id]?.[key] ?? savedLimitText(role, key);
  const setLimitDraft = (role: Role, key: string, text: string) =>
    setLimitDrafts(prev => ({ ...prev, [role.id]: { ...prev[role.id], [key]: text } }));
  const limitsChanged = (role: Role) =>
    limitDefs.some(d => parseLimitText(limitDraft(role, d.key)) !== parseLimitText(savedLimitText(role, d.key)));
  const invalidLimits = roles.some(role => limitDefs.some(d => parseLimitText(limitDraft(role, d.key)) === false));
  const has = (role: Role, key: string) => {
    if (drafts[role.id]) return drafts[role.id].has(key);
    return role.permissions.includes('*') || role.permissions.includes(key);
  };

  const toggle = (role: Role, key: string) => {
    setDrafts(prev => {
      const next = new Set(prev[role.id] ?? role.permissions);
      if (next.has(key)) next.delete(key); else next.add(key);
      return { ...prev, [role.id]: next };
    });
  };

  const permissionsChanged = (role: Role) => {
    const draft = drafts[role.id];
    return !!draft && (draft.size !== role.permissions.length || role.permissions.some(p => !draft.has(p)));
  };
  const changedIds = roles.filter(r => permissionsChanged(r) || limitsChanged(r)).map(r => r.id);

  const save = async () => {
    setSaving(true);
    try {
      for (const id of changedIds) {
        const role = roles.find(r => r.id === id)!;
        const body: { permissions?: string[]; limits?: LimitValue[] } = {};
        if (permissionsChanged(role)) body.permissions = [...drafts[id]];
        if (limitsChanged(role)) {
          body.limits = limitDefs.flatMap(d => {
            const value = parseLimitText(limitDraft(role, d.key));
            return value === undefined || value === false ? [] : [{ key: d.key, value }];
          });
        }
        await api(`/api/admin/roles/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
      }
      await onSaved(`Saved ${changedIds.length} role${changedIds.length === 1 ? '' : 's'}.`);
    } catch (e: any) {
      onError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api('/api/admin/roles', { method: 'POST', body: JSON.stringify({ ...newRole, permissions: [] }) });
      setNewRole({ name: '', rank: 15, description: '' });
      await onSaved(`Created ${newRole.name}. Tick its permissions below, then save.`);
    } catch (err: any) {
      onError(err.message);
    }
  };

  const remove = async (role: Role) => {
    if (!window.confirm(`Delete the ${role.name} role? ${role.member_count} user(s) will lose it.`)) return;
    try {
      await api(`/api/admin/roles/${role.id}`, { method: 'DELETE' });
      await onSaved(`Deleted ${role.name}.`);
    } catch (e: any) {
      onError(e.message);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600 dark:text-gray-300">
        Every signed-in user has the Player role and signed-out visitors have Guest. Other roles add to Player.
        Higher-ranked roles can assign lower ones.
      </p>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 bg-gray-50 dark:bg-gray-700">
            <tr>
              <th className="text-left p-3 font-semibold text-gray-900 dark:text-gray-100 min-w-[16rem]">Permission</th>
              {roles.map(role => (
                <th key={role.id} className="p-3 text-center align-bottom min-w-[6.5rem]">
                  <div className="font-semibold text-gray-900 dark:text-gray-100">{role.name}</div>
                  <div className="text-xs font-normal text-gray-500 dark:text-gray-400">
                    rank {role.rank}
                    {!IMPLICIT_ROLES.includes(role.key) && ` · ${role.member_count} user${role.member_count === 1 ? '' : 's'}`}
                  </div>
                  {!role.built_in && editable(role) && (
                    <button onClick={() => remove(role)} className="text-xs text-red-600 dark:text-red-400 hover:underline">
                      Delete
                    </button>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map(group => (
              <GroupRows key={group.id} group={group} roles={roles} has={has} toggle={toggle} editable={editable} myPermissions={myPermissions} />
            ))}
            {limitDefs.length > 0 && (
              <tr className="bg-gray-100 dark:bg-gray-900">
                <td colSpan={roles.length + 1} className="px-3 py-2">
                  <div className="font-semibold text-gray-700 dark:text-gray-200">Limits</div>
                  <div className="text-xs font-normal text-gray-500 dark:text-gray-400">
                    A number, {NO_LIMIT} for no limit, or blank to leave it to the user&apos;s other roles.
                    The most generous of a user&apos;s roles applies; blank on Player means no limit.
                  </div>
                </td>
              </tr>
            )}
            {limitDefs.map(d => (
              <tr key={d.key} className="border-t border-gray-100 dark:border-gray-700">
                <td className="px-3 py-2">
                  <div className="text-gray-900 dark:text-gray-100">{d.label}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    <code>{d.key}</code>{d.description ? ` · ${d.description}` : ''}
                  </div>
                </td>
                {roles.map(role => {
                  const text = limitDraft(role, d.key);
                  const invalid = parseLimitText(text) === false;
                  return (
                    <td key={role.id} className="text-center px-1">
                      <input
                        aria-label={`${role.name}: ${d.label}`}
                        value={text}
                        placeholder="–"
                        disabled={!limitsEditable(role)}
                        onChange={e => setLimitDraft(role, d.key, e.target.value)}
                        className={`w-16 px-1 py-0.5 text-center rounded border dark:bg-gray-700 dark:text-gray-100 disabled:opacity-60 ${
                          invalid ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'
                        }`}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canEdit && (
        <div className="flex items-center gap-3">
          <button
            onClick={save}
            disabled={!changedIds.length || saving || invalidLimits}
            className="px-4 py-2 rounded-md text-white bg-indigo-500 hover:bg-indigo-600 disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          {changedIds.length > 0 && (
            <button onClick={() => { setDrafts({}); setLimitDrafts({}); }} className="text-sm text-gray-600 dark:text-gray-300 hover:underline">
              Discard
            </button>
          )}
          {invalidLimits && (
            <span className="text-sm text-red-600 dark:text-red-400">Limits must be whole numbers, {NO_LIMIT} or blank.</span>
          )}
        </div>
      )}

      {canEdit && (
        <form onSubmit={create} className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 flex flex-wrap items-end gap-3">
          <h2 className="w-full font-semibold text-gray-900 dark:text-gray-100">New role</h2>
          <label className="text-sm text-gray-700 dark:text-gray-200">
            Name
            <input
              required
              value={newRole.name}
              onChange={e => setNewRole({ ...newRole, name: e.target.value })}
              className="block mt-1 px-2 py-1 rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-700"
            />
          </label>
          <label className="text-sm text-gray-700 dark:text-gray-200">
            Rank
            <input
              type="number"
              value={newRole.rank}
              onChange={e => setNewRole({ ...newRole, rank: parseInt(e.target.value, 10) || 0 })}
              className="block mt-1 w-24 px-2 py-1 rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-700"
            />
          </label>
          <label className="text-sm text-gray-700 dark:text-gray-200 flex-1 min-w-[12rem]">
            Description
            <input
              value={newRole.description}
              onChange={e => setNewRole({ ...newRole, description: e.target.value })}
              className="block mt-1 w-full px-2 py-1 rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-700"
            />
          </label>
          <button type="submit" className="px-4 py-2 rounded-md text-white bg-indigo-500 hover:bg-indigo-600">
            Create
          </button>
        </form>
      )}
    </div>
  );
}

function GroupRows({
  group, roles, has, toggle, editable, myPermissions,
}: {
  group: PermissionGroup;
  roles: Role[];
  has: (role: Role, key: string) => boolean;
  toggle: (role: Role, key: string) => void;
  editable: (role: Role) => boolean;
  myPermissions: Set<string> | null;
}) {
  return (
    <>
      <tr className="bg-gray-100 dark:bg-gray-900">
        <td colSpan={roles.length + 1} className="px-3 py-2 font-semibold text-gray-700 dark:text-gray-200">
          {group.label}
        </td>
      </tr>
      {group.permissions.map(p => (
        <tr key={p.key} className="border-t border-gray-100 dark:border-gray-700">
          <td className="px-3 py-2">
            <div className="text-gray-900 dark:text-gray-100">{p.label}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              <code>{p.key}</code>{p.description ? ` · ${p.description}` : ''}
            </div>
          </td>
          {roles.map(role => {
            // Nobody can hand out a permission they don't hold themselves
            const disabled = !editable(role) || (myPermissions !== null && !myPermissions.has(p.key));
            return (
              <td key={role.id} className="text-center">
                <input
                  type="checkbox"
                  aria-label={`${role.name}: ${p.label}`}
                  checked={has(role, p.key)}
                  disabled={disabled}
                  onChange={() => toggle(role, p.key)}
                  className="h-4 w-4 accent-indigo-500 disabled:opacity-50"
                />
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}

function UsersTab({
  roles, groups, limitDefs, canAssign, canManageRank, me, onSaved, onError,
}: {
  roles: Role[];
  groups: PermissionGroup[];
  limitDefs: LimitDef[];
  canAssign: boolean;
  canManageRank: (rank: number) => boolean;
  me: Me;
  onSaved: (message: string) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [searching, setSearching] = useState(false);

  const search = useCallback(async (q: string) => {
    setSearching(true);
    try {
      const data = await api<{ users: AdminUser[] }>(`/api/admin/users?q=${encodeURIComponent(q)}`);
      setUsers(data.users);
    } catch (e: any) {
      onError(e.message);
    } finally {
      setSearching(false);
    }
  }, [onError]);

  useEffect(() => { search(''); }, [search]);

  const roleName = (key: string) => roles.find(r => r.key === key)?.name ?? key;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4">
        <form onSubmit={e => { e.preventDefault(); search(query); }} className="flex gap-2 mb-3">
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search by email or username"
            className="flex-1 px-3 py-2 rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
          />
          <button type="submit" className="px-4 py-2 rounded-md text-white bg-indigo-500 hover:bg-indigo-600">Search</button>
        </form>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
          {query ? (searching ? 'Searching…' : `${users.length} result(s)`) : 'Users with extra roles, overrides, limits, bans or suspensions'}
        </p>
        <ul className="divide-y divide-gray-100 dark:divide-gray-700">
          {users.map(u => (
            <li key={u.id}>
              <button
                onClick={() => setSelected(u)}
                className={`w-full text-left px-2 py-2 rounded ${selected?.id === u.id ? 'bg-indigo-50 dark:bg-gray-700' : 'hover:bg-gray-50 dark:hover:bg-gray-700'}`}
              >
                <div className="font-medium text-gray-900 dark:text-gray-100">{u.username}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">{u.email}</div>
                <div className="flex flex-wrap gap-1 mt-1">
                  {u.bootstrapAdmin && <Badge tone="red">ADMIN_EMAILS</Badge>}
                  {u.roles.map(k => <Badge key={k}>{roleName(k)}</Badge>)}
                  {u.overrides.length > 0 && <Badge tone="amber">{u.overrides.length} override(s)</Badge>}
                  {(u.limits?.length ?? 0) > 0 && <Badge tone="amber">{u.limits.length} limit(s)</Badge>}
                  {u.sanction && <Badge tone="red">{u.sanction.kind === 'ban' ? 'Banned' : 'Suspended'}</Badge>}
                </div>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {selected ? (
        <UserEditor
          key={selected.id}
          user={selected}
          roles={roles}
          groups={groups}
          limitDefs={limitDefs}
          canAssign={canAssign && (me.bootstrapAdmin || !selected.bootstrapAdmin)}
          canManageRank={canManageRank}
          me={me}
          myPermissions={me.bootstrapAdmin ? null : new Set(me.permissions)}
          onSaved={async text => { await search(query); setSelected(null); await onSaved(text); }}
          onError={onError}
        />
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 text-gray-500 dark:text-gray-400">
          Pick a user to see and change their roles.
        </div>
      )}
    </div>
  );
}

function UserEditor({
  user, roles, groups, limitDefs, canAssign, canManageRank, me, myPermissions, onSaved, onError,
}: {
  user: AdminUser;
  roles: Role[];
  groups: PermissionGroup[];
  limitDefs: LimitDef[];
  canAssign: boolean;
  canManageRank: (rank: number) => boolean;
  me: Me;
  myPermissions: Set<string> | null;
  onSaved: (message: string) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [assigned, setAssigned] = useState(new Set(user.roles));
  const [overrides, setOverrides] = useState<Override[]>(user.overrides);
  const [draft, setDraft] = useState<Override>({ permission: '', effect: 'deny', reason: '' });
  const [limitTexts, setLimitTexts] = useState<Record<string, string>>(
    Object.fromEntries((user.limits ?? []).map(l => [l.key, limitText(l.value)]))
  );
  const [saving, setSaving] = useState(false);

  // What the user's roles give them, shown where they have no limit of their own
  const userRoles = roles.filter(r => r.key === 'player' || assigned.has(r.key));
  const invalidLimit = limitDefs.some(d => parseLimitText(limitTexts[d.key] ?? '') === false);
  const limitsPayload = () => limitDefs.flatMap(d => {
    const value = parseLimitText(limitTexts[d.key] ?? '');
    const reason = user.limits?.find(l => l.key === d.key)?.reason ?? null;
    return value === undefined || value === false ? [] : [{ key: d.key, value, reason }];
  });

  const assignable = roles.filter(r => !IMPLICIT_ROLES.includes(r.key));
  const permissionLabel = useMemo(() => {
    const m = new Map<string, string>();
    groups.forEach(g => g.permissions.forEach(p => m.set(p.key, `${g.label}: ${p.label}`)));
    return m;
  }, [groups]);

  const addOverride = () => {
    if (!draft.permission) return;
    setOverrides(prev => [...prev.filter(o => o.permission !== draft.permission), { ...draft, reason: draft.reason || null }]);
    setDraft({ permission: '', effect: 'deny', reason: '' });
  };

  const save = async () => {
    setSaving(true);
    try {
      await api(`/api/admin/users/${user.id}/access`, {
        method: 'PUT',
        body: JSON.stringify({ roles: [...assigned], overrides, limits: limitsPayload() }),
      });
      await onSaved(`Updated ${user.username}.`);
    } catch (e: any) {
      onError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{user.username}</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">{user.email}</p>
        {user.bootstrapAdmin && (
          <p className="mt-2 text-sm text-red-700 dark:text-red-400">
            Listed in ADMIN_EMAILS, so this user always has every permission. Remove them from that
            environment variable to manage them here.
          </p>
        )}
      </div>

      <section>
        <h3 className="font-medium text-gray-900 dark:text-gray-100 mb-2">Roles</h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Player is always included.</p>
        <div className="grid sm:grid-cols-2 gap-2">
          {assignable.map(r => (
            <label key={r.id} className="flex items-start gap-2 text-sm text-gray-800 dark:text-gray-200">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 accent-indigo-500"
                checked={assigned.has(r.key)}
                disabled={!canAssign || !canManageRank(r.rank)}
                onChange={() => setAssigned(prev => {
                  const next = new Set(prev);
                  if (next.has(r.key)) next.delete(r.key); else next.add(r.key);
                  return next;
                })}
              />
              <span>
                {r.name} <span className="text-xs text-gray-500">rank {r.rank}</span>
                {r.description && <span className="block text-xs text-gray-500 dark:text-gray-400">{r.description}</span>}
              </span>
            </label>
          ))}
        </div>
      </section>

      <section>
        <h3 className="font-medium text-gray-900 dark:text-gray-100 mb-2">Overrides</h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
          Exceptions for this user only. A deny beats any role, for example to block chat without changing roles.
        </p>
        {overrides.length === 0 && <p className="text-sm text-gray-500 dark:text-gray-400">None.</p>}
        <ul className="space-y-1 mb-3">
          {overrides.map(o => (
            <li key={o.permission} className="flex items-center gap-2 text-sm">
              <Badge tone={o.effect === 'deny' ? 'red' : 'green'}>{o.effect}</Badge>
              <span className="text-gray-800 dark:text-gray-200">{permissionLabel.get(o.permission) ?? o.permission}</span>
              {o.reason && <span className="text-gray-500 dark:text-gray-400">· {o.reason}</span>}
              {canAssign && (
                <button
                  onClick={() => setOverrides(prev => prev.filter(x => x.permission !== o.permission))}
                  className="ml-auto text-xs text-red-600 dark:text-red-400 hover:underline"
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
        {canAssign && (
          <div className="flex flex-wrap gap-2 items-center">
            <select
              value={draft.effect}
              onChange={e => setDraft({ ...draft, effect: e.target.value as Override['effect'] })}
              className="px-2 py-1 rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 text-sm"
            >
              <option value="deny">Deny</option>
              <option value="grant">Grant</option>
            </select>
            <select
              value={draft.permission}
              onChange={e => setDraft({ ...draft, permission: e.target.value })}
              className="flex-1 min-w-[12rem] px-2 py-1 rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 text-sm"
            >
              <option value="">Choose a permission…</option>
              {groups.map(g => (
                <optgroup key={g.id} label={g.label}>
                  {g.permissions
                    .filter(p => myPermissions === null || myPermissions.has(p.key))
                    .map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
                </optgroup>
              ))}
            </select>
            <input
              value={draft.reason ?? ''}
              onChange={e => setDraft({ ...draft, reason: e.target.value })}
              placeholder="Reason (optional)"
              className="flex-1 min-w-[10rem] px-2 py-1 rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 text-sm"
            />
            <button onClick={addOverride} disabled={!draft.permission} className="px-3 py-1 rounded-md text-sm text-white bg-gray-600 hover:bg-gray-700 disabled:bg-gray-400">
              Add
            </button>
          </div>
        )}
      </section>

      {limitDefs.length > 0 && (
        <section>
          <h3 className="font-medium text-gray-900 dark:text-gray-100 mb-2">Limits</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
            This user&apos;s own limits replace their roles&apos;. A number, {NO_LIMIT} for no limit, or blank to use their roles&apos;.
          </p>
          <div className="space-y-2">
            {limitDefs.map(d => {
              const fromRoles = rolesLimit(userRoles, d.key);
              const text = limitTexts[d.key] ?? '';
              return (
                <label key={d.key} className="flex flex-wrap items-center gap-2 text-sm text-gray-800 dark:text-gray-200">
                  <span className="flex-1 min-w-[10rem]">{d.label}</span>
                  <input
                    value={text}
                    placeholder="–"
                    disabled={!canAssign}
                    onChange={e => setLimitTexts(prev => ({ ...prev, [d.key]: e.target.value }))}
                    className={`w-20 px-2 py-1 text-center rounded border dark:bg-gray-700 dark:text-gray-100 disabled:opacity-60 ${
                      parseLimitText(text) === false ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'
                    }`}
                  />
                  <span className="w-28 text-xs text-gray-500 dark:text-gray-400">
                    Roles: {fromRoles === undefined || fromRoles === null ? 'no limit' : fromRoles}
                  </span>
                </label>
              );
            })}
          </div>
        </section>
      )}

      {canAssign && (
        <div className="flex items-center gap-3">
          <button
            onClick={save}
            disabled={saving || invalidLimit}
            className="px-4 py-2 rounded-md text-white bg-indigo-500 hover:bg-indigo-600 disabled:bg-gray-400"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          {invalidLimit && (
            <span className="text-sm text-red-600 dark:text-red-400">Limits must be whole numbers, {NO_LIMIT} or blank.</span>
          )}
        </div>
      )}

      <SanctionSection user={user} roles={roles} me={me} onSaved={onSaved} onError={onError} />
    </div>
  );
}

const SANCTION_DURATIONS: { label: string; hours: number | null }[] = [
  { label: '1 day', hours: 24 },
  { label: '3 days', hours: 72 },
  { label: '7 days', hours: 24 * 7 },
  { label: '30 days', hours: 24 * 30 },
  { label: 'No end (bans only)', hours: null },
];

function SanctionSection({
  user, roles, me, onSaved, onError,
}: {
  user: AdminUser;
  roles: Role[];
  me: Me;
  onSaved: (message: string) => Promise<void>;
  onError: (message: string) => void;
}) {
  const canBan = me.permissions.includes('admin.users.ban');
  const canSuspend = me.permissions.includes('admin.users.suspend');
  const [kind, setKind] = useState<'ban' | 'suspend'>(canSuspend ? 'suspend' : 'ban');
  const [hours, setHours] = useState<number | null>(24);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  if (!canBan && !canSuspend) return null;

  const targetRank = Math.max(10, ...roles.filter(r => user.roles.includes(r.key)).map(r => r.rank));
  const blocked = user.bootstrapAdmin
    ? 'Users in ADMIN_EMAILS can\'t be banned or suspended.'
    : !me.bootstrapAdmin && targetRank >= me.rank
      ? 'You can only ban or suspend users ranked below you.'
      : null;
  const current = user.sanction;
  const canLift = !!current && (current.kind === 'ban' ? canBan : canSuspend);

  const run = async (init: RequestInit, done: string) => {
    setBusy(true);
    try {
      await api(`/api/admin/users/${user.id}/sanction`, init);
      await onSaved(done);
    } catch (e: any) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const apply = () => {
    const verb = kind === 'ban' ? 'Ban' : 'Suspend';
    const length = hours === null ? 'with no end' : `for ${SANCTION_DURATIONS.find(d => d.hours === hours)?.label}`;
    if (!window.confirm(`${verb} ${user.username} ${length}?${kind === 'ban' ? ' They will be signed out.' : ''}`)) return;
    const until = hours === null ? null : new Date(Date.now() + hours * 3_600_000).toISOString();
    run(
      { method: 'POST', body: JSON.stringify({ kind, until, reason: reason || undefined }) },
      `${kind === 'ban' ? 'Banned' : 'Suspended'} ${user.username}.`
    );
  };

  return (
    <section className="border-t border-gray-200 dark:border-gray-700 pt-4">
      <h3 className="font-medium text-gray-900 dark:text-gray-100 mb-2">Ban or suspend</h3>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
        Either leaves the user only what signed-out visitors can do. A ban also signs them out and stops them signing in.
        This takes effect right away, without Save.
      </p>
      {current && (
        <div className="mb-3 p-2 rounded bg-red-50 dark:bg-red-900/30 text-sm text-red-800 dark:text-red-200 flex flex-wrap items-center gap-2">
          <span>
            {current.kind === 'ban' ? 'Banned' : 'Suspended'}
            {current.until ? ` until ${new Date(current.until).toLocaleString()}` : ' with no end'}
            {current.reason ? ` · ${current.reason}` : ''}
          </span>
          {canLift && !blocked && (
            <button
              onClick={() => run({ method: 'DELETE' }, `Lifted the ${current.kind === 'ban' ? 'ban' : 'suspension'} on ${user.username}.`)}
              disabled={busy}
              className="ml-auto px-3 py-1 rounded-md text-sm text-white bg-gray-600 hover:bg-gray-700 disabled:bg-gray-400"
            >
              Lift
            </button>
          )}
        </div>
      )}
      {blocked ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">{blocked}</p>
      ) : current && current.kind === 'ban' && !canBan ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">Only users who can ban can change a ban.</p>
      ) : (
        <div className="flex flex-wrap gap-2 items-center">
          <select
            value={kind}
            onChange={e => {
              const next = e.target.value as 'ban' | 'suspend';
              setKind(next);
              if (next === 'suspend' && hours === null) setHours(24);
            }}
            className="px-2 py-1 rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 text-sm"
          >
            {canSuspend && <option value="suspend">Suspend</option>}
            {canBan && <option value="ban">Ban</option>}
          </select>
          <select
            value={hours === null ? '' : String(hours)}
            onChange={e => setHours(e.target.value ? Number(e.target.value) : null)}
            className="px-2 py-1 rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 text-sm"
          >
            {SANCTION_DURATIONS.filter(d => d.hours !== null || kind === 'ban').map(d => (
              <option key={d.label} value={d.hours === null ? '' : String(d.hours)}>{d.label}</option>
            ))}
          </select>
          <input
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Reason (shown to the user)"
            className="flex-1 min-w-[10rem] px-2 py-1 rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 text-sm"
          />
          <button
            onClick={apply}
            disabled={busy}
            className="px-3 py-1 rounded-md text-sm text-white bg-red-600 hover:bg-red-700 disabled:bg-gray-400"
          >
            {current ? 'Replace' : kind === 'ban' ? 'Ban' : 'Suspend'}
          </button>
        </div>
      )}
    </section>
  );
}

function AuditTab({ onError }: { onError: (message: string) => void }) {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);

  useEffect(() => {
    api<{ entries: AuditEntry[] }>('/api/admin/audit-log')
      .then(d => setEntries(d.entries))
      .catch(e => onError(e.message));
  }, [onError]);

  if (!entries) return <p className="text-gray-600 dark:text-gray-300">Loading…</p>;
  if (!entries.length) return <p className="text-gray-600 dark:text-gray-300">No admin actions yet.</p>;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50 dark:bg-gray-700 text-left text-gray-900 dark:text-gray-100">
          <tr>
            <th className="p-3">When</th>
            <th className="p-3">Who</th>
            <th className="p-3">Action</th>
            <th className="p-3">Details</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(e => (
            <tr key={e.id} className="border-t border-gray-100 dark:border-gray-700 text-gray-800 dark:text-gray-200 align-top">
              <td className="p-3 whitespace-nowrap">{new Date(e.created_at).toLocaleString()}</td>
              <td className="p-3">{e.actor_username ?? e.actor_email ?? 'unknown'}</td>
              <td className="p-3"><code>{e.action}</code></td>
              <td className="p-3 text-xs"><code className="break-all">{e.details ? JSON.stringify(e.details) : ''}</code></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Badge({ children, tone = 'indigo' }: { children: React.ReactNode; tone?: 'indigo' | 'red' | 'amber' | 'green' }) {
  const tones = {
    indigo: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200',
    red: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
    amber: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
    green: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  };
  return <span className={`px-1.5 py-0.5 rounded text-xs ${tones[tone]}`}>{children}</span>;
}
