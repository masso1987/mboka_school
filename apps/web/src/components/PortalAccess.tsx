import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTenantMutation } from '../lib/hooks';
import { Button, ErrorMessage, Input } from './ui';

/**
 * Gives a guardian or a student their own portal account, or revokes it. A new account's
 * one-time password is shown once to the staff member, who hands it over (Module 12).
 */
export function PortalAccess({ kind, id, enabled, studentId }: { kind: 'guardians' | 'students'; id: string; enabled: boolean; studentId: string }) {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [open, setOpen] = useState(false);
  const grant = useTenantMutation<object, { temporaryPassword?: string }>('POST', `/${kind}/${id}/portal-access`, [['student', studentId]]);
  const revoke = useTenantMutation<object>('DELETE', `/${kind}/${id}/portal-access`, [['student', studentId]]);

  if (grant.data) {
    return (
      <div role="status" className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
        {grant.data.temporaryPassword ? (
          <>
            {t('portal.tempPassword')} <span className="select-all font-mono text-sm">{grant.data.temporaryPassword}</span>
            <span className="block">{t('admin.tempPasswordWarning')}</span>
          </>
        ) : (
          t('portal.linkedExisting')
        )}
      </div>
    );
  }
  if (enabled) {
    return (
      <div className="mt-1 flex items-center gap-2 text-xs">
        <span className="text-success-600">{t('portal.enabled')}</span>
        <button type="button" className="text-danger-600 hover:underline" onClick={() => window.confirm(t('portal.revokeConfirm')) && revoke.mutate({})}>
          {t('portal.revoke')}
        </button>
        <ErrorMessage error={revoke.error} />
      </div>
    );
  }
  return open ? (
    <form
      className="mt-2 flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        grant.mutate({ email });
      }}
    >
      <Input type="email" required placeholder={t('admin.email')} value={email} onChange={(e) => setEmail(e.target.value)} className="max-w-56 text-xs" />
      <Button type="submit" disabled={grant.isPending}>
        {t('portal.grant')}
      </Button>
      <ErrorMessage error={grant.error} />
    </form>
  ) : (
    <button type="button" className="mt-1 text-xs text-accent-700 hover:underline" onClick={() => setOpen(true)}>
      {t('portal.grantAccess')}
    </button>
  );
}
