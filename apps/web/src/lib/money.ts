import { useTranslation } from 'react-i18next';

/**
 * Display-only formatting of API decimal strings. Amounts are never computed in the browser:
 * the server returns exact decimal strings and this only renders them for the locale.
 */
export function useMoney() {
  const { i18n } = useTranslation();
  const locale = i18n.resolvedLanguage === 'en' ? 'en-GB' : 'fr-FR';
  return (amount: string | null | undefined, currency: string) => {
    if (amount === null || amount === undefined) return '—';
    const decimals = amount.includes('.') ? amount.split('.')[1]!.length : 0;
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(Number(amount));
  };
}

export const newKey = () => crypto.randomUUID();
