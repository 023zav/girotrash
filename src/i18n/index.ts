import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ca from './ca.json';
import es from './es.json';
import en from './en.json';
import { STORAGE_KEYS } from '../lib/constants';

const savedLang = localStorage.getItem(STORAGE_KEYS.lang) || 'ca';

i18n.use(initReactI18next).init({
  resources: {
    ca: { translation: ca },
    es: { translation: es },
    en: { translation: en },
  },
  lng: savedLang,
  fallbackLng: 'ca',
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
