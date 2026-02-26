import { useTranslation } from 'react-i18next';
import LanguageBar from '../components/LanguageBar';

export default function PrivacyPolicy() {
  const { t } = useTranslation();

  return (
    <div className="privacy-page">
      <LanguageBar />
      <h1>{t('privacy.title')}</h1>

      <p>{t('privacy.intro')}</p>

      <h2>{t('privacy.dataTitle')}</h2>
      <p>{t('privacy.dataText')}</p>

      <h2>{t('privacy.purposeTitle')}</h2>
      <p>{t('privacy.purposeText')}</p>

      <h2>{t('privacy.retentionTitle')}</h2>
      <p>{t('privacy.retentionText')}</p>

      <h2>{t('privacy.rightsTitle')}</h2>
      <p>{t('privacy.rightsText')}</p>

      <h2>{t('privacy.contactTitle')}</h2>
      <p>
        <a href="mailto:info@gironaneta.cat">info@gironaneta.cat</a>
      </p>

      <div style={{ marginTop: 32 }}>
        <a href="/" style={{ fontSize: 14 }}>
          &larr; {t('privacy.back')}
        </a>
      </div>
    </div>
  );
}
