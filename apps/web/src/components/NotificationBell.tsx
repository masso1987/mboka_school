import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useDateFormat, useTenantMutation, useTenantQuery } from '../lib/hooks';

interface Inbox {
  unread: number;
  items: { id: string; kind: string; title: string; body: string; link: string | null; read: boolean; createdAt: string }[];
}

/** Header inbox (COM-005): unread count, recent notifications, mark as read. Polls every minute. */
export function NotificationBell() {
  const { t } = useTranslation();
  const fmt = useDateFormat();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const inbox = useTenantQuery<Inbox>(['notifications'], '/notifications');
  const read = useTenantMutation<string>('POST', (id) => `/notifications/${id}/read`, [['notifications']]);
  const readAll = useTenantMutation<object>('POST', '/notifications/read-all', [['notifications']]);

  useEffect(() => {
    const id = window.setInterval(() => void inbox.refetch(), 60_000);
    return () => window.clearInterval(id);
  }, [inbox]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const unread = inbox.data?.unread ?? 0;
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-label={t('notifications.title', { count: unread })}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-md px-2 py-1 text-slate-700 hover:bg-slate-100"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-danger-600 px-1 text-center text-[10px] font-semibold text-white">{unread > 99 ? '99+' : unread}</span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2">
            <span className="text-sm font-semibold">{t('notifications.heading')}</span>
            {unread > 0 && (
              <button type="button" className="text-xs text-accent-700 hover:underline" onClick={() => readAll.mutate({})}>
                {t('notifications.markAll')}
              </button>
            )}
          </div>
          <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
            {(inbox.data?.items.length ?? 0) === 0 ? (
              <li className="px-4 py-6 text-center text-sm text-slate-500">{t('notifications.empty')}</li>
            ) : (
              inbox.data!.items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => {
                      if (!n.read) read.mutate(n.id);
                      setOpen(false);
                      if (n.link) void navigate(n.link);
                    }}
                    className={`block w-full px-4 py-3 text-left hover:bg-slate-50 ${n.read ? '' : 'bg-accent-50'}`}
                  >
                    <span className="block text-sm font-medium">{n.title}</span>
                    <span className="block text-xs text-slate-600">{n.body}</span>
                    <span className="mt-1 block text-[11px] text-slate-400">{fmt(n.createdAt.slice(0, 10))}</span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
