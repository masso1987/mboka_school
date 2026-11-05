import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, Empty, ErrorMessage, Field, Input, Loading, PageHeader, Select, Table } from '../components/ui';
import { useCurrentYear, useTenantMutation, useTenantQuery } from '../lib/hooks';
import { useMoney } from '../lib/money';
import { useSession } from '../lib/session';
import type { SchoolClass } from '../lib/types';

interface Book {
  id: string;
  levelId: string | null;
  classId: string | null;
  subject: string | null;
  title: string;
  author: string | null;
  publisher: string | null;
  price: string | null;
  currency: string;
}
interface ClassList {
  class: { id: string; name: string };
  academicYear: string;
  items: Book[];
  totals: { currency: string; total: string }[];
}

/** Each class's book list for the year, with indicative prices, printed for parents (they buy the books outside). */
export function BookListsPage() {
  const { t } = useTranslation();
  const { can, context } = useSession();
  const { current } = useCurrentYear();
  const classes = useTenantQuery<SchoolClass[]>(['classes', current?.id], current ? `/classes?academicYearId=${current.id}` : null);
  const [classId, setClassId] = useState('');
  useEffect(() => {
    if (!classId && classes.data?.[0]) setClassId(classes.data[0].id);
  }, [classes.data, classId]);
  const list = useTenantQuery<ClassList>(['book-list', classId], classId ? `/book-lists/classes/${classId}` : null);
  const money = useMoney();
  const remove = useTenantMutation<{ id: string }>('DELETE', (b) => `/book-lists/items/${b.id}`, [['book-list']]);
  const manage = can('academics.structure.manage');
  const schoolClass = classes.data?.find((c) => c.id === classId);
  const scopeOf = (b: Book) => (b.classId ? t('books.scopeClass') : b.levelId ? t('books.scopeLevel') : t('books.scopeSchool'));

  return (
    <div className="space-y-6">
      <div className="print:hidden">
        <PageHeader
          title={t('nav.bookLists')}
          description={t('books.intro')}
          actions={
            <div className="flex gap-2">
              <Select className="w-48" value={classId} onChange={(e) => setClassId(e.target.value)} aria-label={t('nav.classes')}>
                {classes.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
              <Button variant="secondary" disabled={!list.data?.items.length} onClick={() => window.print()}>
                {t('books.print')}
              </Button>
            </div>
          }
        />
      </div>
      {list.isPending ? (
        classId ? <Loading /> : null
      ) : list.isError ? (
        <ErrorMessage error={list.error} />
      ) : (
        <Card>
          <div className="hidden print:mb-4 print:block">
            <p className="text-lg font-bold">{context?.tenant.tradingName ?? context?.tenant.legalName}</p>
            <p className="text-base">{t('books.printTitle', { className: list.data.class.name, year: list.data.academicYear })}</p>
          </div>
          {list.data.items.length === 0 ? (
            <Empty>{t('books.empty')}</Empty>
          ) : (
            <Table head={[t('books.subject'), t('books.title'), t('books.author'), t('books.publisher'), t('books.price'), ...(manage ? [''] : [])]}>
              {list.data.items.map((b) => (
                <tr key={b.id}>
                  <td>{b.subject ?? '—'}</td>
                  <td>
                    <p className="font-medium">{b.title}</p>
                    {manage && <p className="text-xs text-slate-500 print:hidden">{scopeOf(b)}</p>}
                  </td>
                  <td>{b.author ?? '—'}</td>
                  <td>{b.publisher ?? '—'}</td>
                  <td className="tabular whitespace-nowrap">{b.price ? money(b.price, b.currency) : '—'}</td>
                  {manage && (
                    <td className="text-right print:hidden">
                      <Button variant="ghost" disabled={remove.isPending} onClick={() => window.confirm(t('books.removeConfirm', { title: b.title })) && remove.mutate({ id: b.id })}>
                        {t('school.remove')}
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </Table>
          )}
          {list.data.totals.map((x) => (
            <p key={x.currency} className="tabular mt-4 flex justify-between border-t border-slate-200 pt-3 text-base">
              <span className="font-semibold">{t('books.total')}</span>
              <span className="font-bold">{money(x.total, x.currency)}</span>
            </p>
          ))}
          <p className="mt-2 text-xs text-slate-500">{t('books.indicative')}</p>
          <ErrorMessage error={remove.error} />
        </Card>
      )}
      {manage && current && schoolClass && <AddBook yearId={current.id} schoolClass={schoolClass} currency={context?.tenant.defaultCurrency ?? 'XAF'} />}
    </div>
  );
}

function AddBook({ yearId, schoolClass, currency }: { yearId: string; schoolClass: SchoolClass; currency: string }) {
  const { t } = useTranslation();
  const empty = { scope: 'class', subject: '', title: '', author: '', publisher: '', price: '' };
  const [f, setF] = useState(empty);
  const add = useTenantMutation<object>('POST', '/book-lists/items', [['book-list']]);
  const text = (k: 'subject' | 'title' | 'author' | 'publisher', required = false) => (
    <Field label={t(`books.${k}`)}>
      <Input required={required} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
    </Field>
  );
  return (
    <Card title={t('books.add')}>
      <form
        className="space-y-4 print:hidden"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          const opt = (v: string) => v.trim() || undefined;
          add.mutate(
            {
              academicYearId: yearId,
              ...(f.scope === 'class' && { classId: schoolClass.id }),
              ...(f.scope === 'level' && { levelId: schoolClass.levelId }),
              title: f.title.trim(),
              subject: opt(f.subject),
              author: opt(f.author),
              publisher: opt(f.publisher),
              price: opt(f.price.replace(/\s/g, '').replace(',', '.')),
              currency,
            },
            { onSuccess: () => setF({ ...empty, scope: f.scope, subject: f.subject }) },
          );
        }}
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t('books.appliesTo')}>
            <Select value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value })}>
              <option value="class">{t('books.thisClass', { name: schoolClass.name })}</option>
              <option value="level">{t('books.thisLevel')}</option>
              <option value="school">{t('books.scopeSchool')}</option>
            </Select>
          </Field>
          {text('subject')}
          {text('title', true)}
          {text('author')}
          {text('publisher')}
          <Field label={`${t('books.price')} (${currency})`}>
            <Input inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />
          </Field>
        </div>
        <Button type="submit" disabled={add.isPending}>
          {t('common.add')}
        </Button>
        <ErrorMessage error={add.error} />
      </form>
    </Card>
  );
}
