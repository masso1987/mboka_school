import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { LOCALES, type Locale } from '@mboka/shared';
import en from './en.json';
import fr from './fr.json';

const STORAGE_KEY = 'mboka.locale';

function storedLocale(): Locale | undefined {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return (LOCALES as readonly string[]).includes(v ?? '') ? (v as Locale) : undefined;
  } catch {
    return undefined;
  }
}

void i18n.use(initReactI18next).init({
  resources: { fr: { translation: fr }, en: { translation: en } },
  lng: storedLocale() ?? 'fr',
  fallbackLng: 'fr',
  interpolation: { escapeValue: false },
});

i18n.on('languageChanged', (lng) => {
  document.documentElement.lang = lng;
});

/** User choice overrides the school's default (spec §9). */
export function setLocale(locale: Locale): void {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // Storage unavailable (private mode): the choice lasts for this page only.
  }
  void i18n.changeLanguage(locale);
}

/** Apply the school's default language unless the user has chosen one. */
export function applyTenantDefaultLocale(locale: string): void {
  if (!storedLocale() && (LOCALES as readonly string[]).includes(locale)) void i18n.changeLanguage(locale);
}

export default i18n;
