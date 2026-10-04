import { ROLES, ROLE_LABELS, type Role } from '@webddeploy/shared';
import { Loader2, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Card, ConfirmButton, ErrorBox, Field, Spinner, Td, Th, inputClass } from '../components/ui.tsx';
import { useMe, useOptions, useRemoveUser, useSetOptions, useSetUser, useUsers } from '../lib/api.ts';
import { relativeTime } from '../lib/format.ts';

const ROLE_HELP: Record<Role, string> = {
  viewer: 'Read-only: sites, history, logs, health, previews, backups.',
  admin: 'Every site action: deploys, provisioning, environment, settings, database, files, backups.',
  superadmin: 'Admin, plus server settings, users and global options.',
};

export function UsersPage() {
  const users = useUsers();
  const me = useMe().data!;
  const setUser = useSetUser();
  const remove = useRemoveUser();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('viewer');

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Users</h1>
      <Card title="Roles">
        <ul className="divide-y divide-stone-100 text-sm dark:divide-stone-800">
          {ROLES.map((r) => (
            <li key={r} className="flex gap-3 px-4 py-2"><span className="w-28 shrink-0 font-medium">{ROLE_LABELS[r]}</span><span className="text-stone-600 dark:text-stone-400">{ROLE_HELP[r]}</span></li>
          ))}
        </ul>
      </Card>
      <Card title="Add or change a user">
        <form
          className="flex flex-wrap items-end gap-3 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            setUser.mutate({ email: email.trim().toLowerCase(), role }, { onSuccess: () => setEmail('') });
          }}
        >
          <div className="min-w-64 flex-1"><Field label="Google account email"><input className={inputClass} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="someone@example.com" required /></Field></div>
          <Field label="Role">
            <select className={inputClass} value={role} onChange={(e) => setRole(e.target.value as Role)} aria-label="Role">
              {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
          </Field>
          <Button type="submit" variant="primary" busy={setUser.isPending} disabled={!email.includes('@')}><UserPlus className="size-4" aria-hidden /> Save</Button>
        </form>
        {setUser.error && <ErrorBox error={setUser.error} />}
      </Card>
      <Card title="Everyone with access">
        {users.isPending ? (
          <Spinner />
        ) : users.error ? (
          <ErrorBox error={users.error} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem]">
              <thead className="border-b border-stone-200 dark:border-stone-800">
                <tr><Th>Email</Th><Th>Role</Th><Th>Set by</Th><Th>Last seen</Th><Th /></tr>
              </thead>
              <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
                {users.data.users.map((u) => (
                  <tr key={u.email}>
                    <Td className="font-medium">{u.email}{u.email === me.email && <span className="ml-2 text-xs text-stone-400">(you)</span>}</Td>
                    <Td>
                      {u.source === 'ui' && u.email !== me.email ? (
                        <select
                          className={`${inputClass} w-36`}
                          value={setUser.isPending && setUser.variables?.email === u.email ? setUser.variables.role : u.role}
                          disabled={setUser.isPending && setUser.variables?.email === u.email}
                          aria-label={`Role of ${u.email}`}
                          onChange={(e) => setUser.mutate({ email: u.email, role: e.target.value as Role })}
                        >
                          {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                        </select>
                      ) : (
                        <Badge tone="neutral">{ROLE_LABELS[u.role]}</Badge>
                      )}
                    </Td>
                    <Td className="text-xs text-stone-500">{u.source === 'config' ? 'server configuration (env file)' : u.added_by}</Td>
                    <Td className="text-xs text-stone-500">{u.last_seen_at ? relativeTime(u.last_seen_at) : 'never'}</Td>
                    <Td className="text-right">
                      {u.source === 'ui' && u.email !== me.email && <ConfirmButton label="Remove" busyLabel="Removing…" confirmLabel={`Remove ${u.email}`} onConfirm={() => remove.mutateAsync(u.email)} />}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {remove.error && <ErrorBox error={remove.error} />}
        <p className="border-t border-stone-200 px-4 py-2 text-xs text-stone-500 dark:border-stone-800">
          Users from the server configuration (<code>SUPERADMIN_EMAILS</code>, <code>ADMIN_EMAILS</code>, <code>VIEWER_EMAILS</code>) can't be changed here, so nobody can lock everyone out. Removing a user signs them out right away.
        </p>
      </Card>
      <DomainOption />
    </div>
  );
}

function DomainOption() {
  const options = useOptions();
  const set = useSetOptions();
  if (!options.data) return null;
  return (
    <Card title="Global options">
      <label className="flex items-start gap-3 p-4 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={set.isPending ? set.variables?.domain_default_role === 'viewer' : options.data.domain_default_role === 'viewer'}
          disabled={set.isPending}
          onChange={(e) => set.mutate({ domain_default_role: e.target.checked ? 'viewer' : 'none' })}
        />
        <span>
          <span className="font-medium">
            {set.isPending && <Loader2 className="mr-1 inline size-3.5 animate-spin" aria-hidden />}
            Anyone in {options.data.allowed_domains?.length ? options.data.allowed_domains.join(', ') : 'the allowed Google Workspace domain'} can view
          </span>
          {!options.data.allowed_domains?.length && (
            <span className="block text-amber-700">No domain is configured (GOOGLE_ALLOWED_DOMAINS), so this has no effect.</span>
          )}
          <span className="block text-stone-500">
            Gives the viewer role to everyone who signs in from a domain in <code>GOOGLE_ALLOWED_DOMAINS</code> without being listed above. Off: only
            listed users get in.
          </span>
        </span>
      </label>
      {set.error && <ErrorBox error={set.error} />}
    </Card>
  );
}
