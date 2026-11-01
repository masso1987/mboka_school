import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { flushPending, OFFLINE_EVENT, pendingSubmissions } from '../lib/offline';
import { useSession } from '../lib/session';

/**
 * Connectivity and sync state in the header (§10.3, §8.4 "unsynchronized changes are visibly
 * distinguished"): offline badge, number of registers waiting, and a sync button. Pending work
 * is also sent automatically as soon as the browser reports it is back online.
 */
export function OfflineIndicator() {
  const { t } = useTranslation();
  const { tenantId } = useSession();
  const qc = useQueryClient();
  const [online, setOnline] = useState(() => navigator.onLine);
  const [pending, setPending] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => setPending(tenantId ? pendingSubmissions(tenantId).length : 0), [tenantId]);

  const sync = useCallback(async () => {
    if (!tenantId || busy) return;
    setBusy(true);
    try {
      const r = await flushPending(tenantId);
      if (r.sent || r.rejected.length) await qc.invalidateQueries({ queryKey: [tenantId, 'register'] });
      setMessage(r.rejected.length ? t('offline.rejected', { count: r.rejected.length }) : r.sent ? t('offline.synced', { count: r.sent }) : null);
    } finally {
      setBusy(false);
      refresh();
    }
  }, [tenantId, busy, qc, t, refresh]);

  useEffect(() => {
    refresh();
    const goOnline = () => {
      setOnline(true);
      void sync();
    };
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    window.addEventListener(OFFLINE_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      window.removeEventListener(OFFLINE_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, [refresh, sync]);

  useEffect(() => {
    if (!message) return;
    const id = window.setTimeout(() => setMessage(null), 6000);
    return () => window.clearTimeout(id);
  }, [message]);

  if (online && pending === 0 && !message) return null;
  return (
    <div role="status" className="flex items-center gap-2 text-xs">
      {!online && <span className="rounded-full bg-slate-800 px-2 py-1 font-medium text-white">{t('offline.offline')}</span>}
      {pending > 0 && (
        <button
          type="button"
          disabled={!online || busy}
          onClick={() => void sync()}
          className="rounded-full bg-amber-100 px-2 py-1 font-medium text-amber-900 disabled:opacity-70"
          title={online ? t('offline.syncNow') : t('offline.waiting')}
        >
          {t('offline.pending', { count: pending })}
          {online && ` · ${t('offline.syncNow')}`}
        </button>
      )}
      {message && <span className="text-slate-600">{message}</span>}
    </div>
  );
}
