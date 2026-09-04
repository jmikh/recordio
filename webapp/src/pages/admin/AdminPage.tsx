/**
 * /admin — hidden admin page: pick any user and impersonate them
 * (plans/admin-user-impersonation-oneshot.md).
 *
 * Gating is server-side: admin-user-list 403s for non-admins, which
 * renders the "Not authorized" state — no allowlist ships to the client.
 *
 * The picker is one fetch + client-side fuzzy filtering: the list
 * arrives most-recently-active first (capped at 500 server-side), an
 * empty query shows it in that order, and typing narrows it by fuzzy
 * score (ties broken by recency). ↑/↓ move the highlight, Enter
 * impersonates it.
 */
import { useEffect, useMemo, useState } from 'react';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { LuLoader } from 'react-icons/lu';
import { Button, LogoLink } from '@shared/components';
import type { AdminUserSummary } from '@shared/api';
import { invokeFunction } from '../../api/client';
import { startImpersonation } from '../../auth/impersonation';
import { fuzzyMatch, type FuzzyMatch } from './fuzzy';

type Status = 'loading' | 'ready' | 'forbidden' | 'error';

interface UserResult {
    user: AdminUserSummary;
    emailMatch: FuzzyMatch | null;
    nameMatch: FuzzyMatch | null;
}

function formatLastActive(iso: string | null): string {
    if (!iso) return 'never';
    const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 30) return `${days}d ago`;
    return new Date(iso).toLocaleDateString();
}

/** Text with the fuzzy-matched characters emphasized. */
function Highlighted({ text, match }: { text: string; match: FuzzyMatch | null }) {
    if (!match || match.positions.length === 0) return <>{text}</>;
    const matched = new Set(match.positions);
    return (
        <>
            {[...text].map((ch, i) =>
                matched.has(i)
                    ? <span key={i} className="text-primary font-bold">{ch}</span>
                    : ch,
            )}
        </>
    );
}

export function AdminPage() {
    const [status, setStatus] = useState<Status>('loading');
    const [users, setUsers] = useState<AdminUserSummary[]>([]);
    const [query, setQuery] = useState('');
    const [highlighted, setHighlighted] = useState(0);
    const [impersonatingId, setImpersonatingId] = useState<string | null>(null);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    useEffect(() => {
        (async () => {
            const { data, error } = await invokeFunction('admin-user-list', {});
            if (error || !data) {
                const forbidden = error instanceof FunctionsHttpError
                    && (error.context as Response).status === 403;
                setStatus(forbidden ? 'forbidden' : 'error');
                return;
            }
            setUsers(data.users);
            setStatus('ready');
        })();
    }, []);

    const results = useMemo<UserResult[]>(() => {
        const q = query.trim();
        if (!q) {
            // Server order is already most-recently-active first
            return users.map(user => ({ user, emailMatch: null, nameMatch: null }));
        }
        return users
            .map((user, index) => {
                const emailMatch = user.email ? fuzzyMatch(q, user.email) : null;
                const nameMatch = user.name ? fuzzyMatch(q, user.name) : null;
                const best = Math.max(emailMatch?.score ?? -1, nameMatch?.score ?? -1);
                return { user, emailMatch, nameMatch, best, index };
            })
            .filter(r => r.best >= 0)
            // Fuzzy score first, recency (server order) breaks ties
            .sort((a, b) => b.best - a.best || a.index - b.index);
    }, [users, query]);

    const impersonate = async (user: AdminUserSummary) => {
        if (impersonatingId) return;
        setImpersonatingId(user.id);
        setErrorMsg(null);
        const { data, error } = await invokeFunction('admin-impersonate', { userId: user.id });
        if (error || !data) {
            setImpersonatingId(null);
            setErrorMsg('Failed to start impersonation.');
            return;
        }
        startImpersonation(data);
    };

    const onKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHighlighted(h => Math.min(h + 1, results.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlighted(h => Math.max(h - 1, 0));
        } else if (e.key === 'Enter' && results[highlighted]) {
            e.preventDefault();
            impersonate(results[highlighted].user);
        }
    };

    return (
        <div className="min-h-screen bg-surface-body flex flex-col items-center px-4 py-10">
            <div className="mb-8">
                <LogoLink imgClassName="h-8" />
            </div>

            <div className="w-full max-w-2xl">
                <h1 className="heading-2 mb-1">Impersonate a user</h1>
                <p className="subtext mb-6">
                    Open the app as any user to inspect their experience. Everything you do is real
                    and audit-logged.
                </p>

                {status === 'loading' && (
                    <div className="flex items-center gap-2 text-sm text-text-muted" role="status">
                        <LuLoader className="icon-md animate-spin" />
                        Loading users...
                    </div>
                )}

                {status === 'forbidden' && (
                    <p className="text-sm text-destructive" role="alert">Not authorized.</p>
                )}

                {status === 'error' && (
                    <p className="text-sm text-destructive" role="alert">Failed to load users.</p>
                )}

                {status === 'ready' && (
                    <>
                        <input
                            type="text"
                            aria-label="Search users"
                            placeholder="Search by email or name..."
                            autoFocus
                            value={query}
                            onChange={e => {
                                setQuery(e.target.value);
                                setHighlighted(0);
                            }}
                            onKeyDown={onKeyDown}
                            className="w-full px-3 py-2 text-sm bg-surface border border-border rounded-(--radius-interactive) text-text-main placeholder:text-text-muted outline-none focus:border-primary transition-colors mb-3"
                        />

                        {errorMsg && (
                            <p className="text-sm text-destructive mb-3" role="alert">{errorMsg}</p>
                        )}

                        {results.length === 0 ? (
                            <p className="text-sm text-text-muted px-3 py-2">No users match.</p>
                        ) : (
                            <ul
                                aria-label="Users"
                                className="border border-border rounded-md bg-surface divide-y divide-border max-h-[60vh] overflow-y-auto scrollbar-thin"
                            >
                                {results.map(({ user, emailMatch, nameMatch }, i) => (
                                    <li
                                        key={user.id}
                                        onMouseEnter={() => setHighlighted(i)}
                                        className={`flex items-center gap-3 px-3 py-2 ${i === highlighted ? 'bg-state-hover' : ''}`}
                                    >
                                        <div className="flex-1 min-w-0">
                                            <div className="text-sm text-text-main truncate">
                                                <Highlighted text={user.email ?? user.id} match={emailMatch} />
                                            </div>
                                            {user.name && (
                                                <div className="text-xs text-text-muted truncate">
                                                    <Highlighted text={user.name} match={nameMatch} />
                                                </div>
                                            )}
                                        </div>
                                        <span className="text-xs text-text-muted w-20 text-right shrink-0">
                                            {formatLastActive(user.last_active_at)}
                                        </span>
                                        <span className="text-xs text-text-muted w-20 text-right shrink-0">
                                            {user.project_count} {user.project_count === 1 ? 'project' : 'projects'}
                                        </span>
                                        <Button
                                            variant="base"
                                            aria-label={`Impersonate ${user.email ?? user.id}`}
                                            disabled={impersonatingId !== null}
                                            onClick={() => impersonate(user)}
                                        >
                                            {impersonatingId === user.id ? 'Starting...' : 'Impersonate'}
                                        </Button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
