import { useTranslation } from 'react-i18next';
import { STORAGE_KEYS } from '../lib/constants';
import type { SupportedLang } from '../types';

const langs: SupportedLang[] = ['ca', 'es', 'en'];

export default function LanguageBar() {
  const { i18n, t } = useTranslation();

  function switchLang(lang: SupportedLang) {
    i18n.changeLanguage(lang);
    localStorage.setItem(STORAGE_KEYS.lang, lang);
  }

  return (
    <div className="lang-bar">
      {langs.map((lang) => (
        <button
          key={lang}
          className={`lang-btn ${i18n.language === lang ? 'active' : ''}`}
          onClick={() => switchLang(lang)}
        >
          {t(`lang.${lang}`)}
        </button>
      ))}
    </div>
  );
}
