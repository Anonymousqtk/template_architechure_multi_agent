import { setLocale, useTranslation, type Locale } from './index';

export function LanguageSelector() {
  const { locale, t } = useTranslation();

  return (
    <label>
      <span className="sr-only">{t('language')}</span>
      <select
        aria-label={t('language')}
        value={locale}
        onChange={(event) => setLocale(event.target.value as Locale)}
      >
        <option value="vi">Tiếng Việt</option>
        <option value="en">English (partial)</option>
      </select>
    </label>
  );
}
