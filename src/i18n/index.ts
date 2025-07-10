import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import Backend from 'i18next-http-backend';

// Import language resources
import en from './locales/en.json';
import tr from './locales/tr.json';
import es from './locales/es.json';

const resources = {
  en: { translation: en },
  tr: { translation: tr },
  es: { translation: es }
};

// Language detection options
const detectionOptions = {
  order: ['localStorage', 'navigator', 'htmlTag'],
  caches: ['localStorage'],
  excludeCacheFor: ['cimode'],
  lookupLocalStorage: 'cinematch_language'
};

// Initialize i18next
i18n
  .use(Backend)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    debug: process.env.NODE_ENV === 'development',
    
    detection: detectionOptions,
    
    interpolation: {
      escapeValue: false // React already escapes values
    },
    
    backend: {
      loadPath: '/locales/{{lng}}.json',
      allowMultiLoading: false
    },
    
    react: {
      useSuspense: false,
      bindI18n: 'languageChanged loaded',
      bindI18nStore: 'added removed',
      transEmptyNodeValue: '',
      transSupportBasicHtmlNodes: true,
      transKeepBasicHtmlNodesFor: ['br', 'strong', 'i', 'em']
    },
    
    // Namespace and key separators
    nsSeparator: false,
    keySeparator: '.',
    
    // Load languages on demand
    load: 'languageOnly',
    preload: ['en', 'tr'],
    
    // Cleanup
    cleanCode: true,
    
    // Custom formatters
    returnObjects: true,
    
    // Pluralization
    returnEmptyString: false,
    
    // Missing key handling
    saveMissing: process.env.NODE_ENV === 'development',
    updateMissing: process.env.NODE_ENV === 'development',
    
    // Custom missing key handler
    missingKeyHandler: (lng: string, ns: string, key: string, fallbackValue: string) => {
      if (process.env.NODE_ENV === 'development') {
        console.warn(`Missing translation key: ${key} for language: ${lng}`);
      }
    }
  });

// Language change event handler
i18n.on('languageChanged', (lng: string) => {
  // Update document language
  document.documentElement.lang = lng;
  
  // Update direction for RTL languages
  const rtlLanguages = ['ar', 'he', 'fa'];
  document.documentElement.dir = rtlLanguages.includes(lng) ? 'rtl' : 'ltr';
  
  // Emit custom event for analytics
  window.dispatchEvent(new CustomEvent('languageChanged', { detail: { language: lng } }));
});

export default i18n;

// Language utilities
export const supportedLanguages = [
  { code: 'en', name: 'English', nativeName: 'English' },
  { code: 'tr', name: 'Turkish', nativeName: 'Türkçe' },
  { code: 'es', name: 'Spanish', nativeName: 'Español' }
];

export const getCurrentLanguage = () => i18n.language;

export const changeLanguage = async (languageCode: string) => {
  try {
    await i18n.changeLanguage(languageCode);
    localStorage.setItem('cinematch_language', languageCode);
    return true;
  } catch (error) {
    console.error('Error changing language:', error);
    return false;
  }
};

export const getAvailableLanguages = () => supportedLanguages;

export const isRTL = (lng?: string) => {
  const language = lng || i18n.language;
  const rtlLanguages = ['ar', 'he', 'fa'];
  return rtlLanguages.includes(language);
};

export const formatMessage = (key: string, options?: any) => {
  return i18n.t(key, options);
};

// Custom hooks and HOCs
export const withTranslation = (component: any) => {
  // This would be implemented as a HOC
  return component;
};

// Date and number formatters for different locales
export const formatDate = (date: Date, locale?: string) => {
  const currentLocale = locale || i18n.language;
  return new Intl.DateTimeFormat(currentLocale).format(date);
};

export const formatNumber = (number: number, locale?: string) => {
  const currentLocale = locale || i18n.language;
  return new Intl.NumberFormat(currentLocale).format(number);
};

export const formatCurrency = (amount: number, currency: string = 'USD', locale?: string) => {
  const currentLocale = locale || i18n.language;
  return new Intl.NumberFormat(currentLocale, {
    style: 'currency',
    currency
  }).format(amount);
};

// Dynamic translation loading
export const loadTranslation = async (namespace: string, language?: string) => {
  const lng = language || i18n.language;
  try {
    await i18n.loadNamespaces(namespace);
    return true;
  } catch (error) {
    console.error(`Error loading translation namespace ${namespace} for language ${lng}:`, error);
    return false;
  }
};

// Validation for translation keys
export const validateTranslationKey = (key: string) => {
  return i18n.exists(key);
};

// Translation completion checker
export const getTranslationCompleteness = (language: string) => {
  const englishKeys = Object.keys(en);
  const targetLanguageKeys = Object.keys(resources[language as keyof typeof resources]?.translation || {});
  
  const completeness = (targetLanguageKeys.length / englishKeys.length) * 100;
  const missingKeys = englishKeys.filter(key => !targetLanguageKeys.includes(key));
  
  return {
    percentage: Math.round(completeness),
    missingKeys,
    totalKeys: englishKeys.length,
    translatedKeys: targetLanguageKeys.length
  };
};

// Browser language detection
export const detectBrowserLanguage = () => {
  const browserLang = navigator.language || navigator.languages[0];
  const langCode = browserLang.split('-')[0];
  
  // Check if we support this language
  const supportedCodes = supportedLanguages.map(lang => lang.code);
  return supportedCodes.includes(langCode) ? langCode : 'en';
};

// Initialize with browser language if no preference is set
export const initializeLanguage = () => {
  const savedLanguage = localStorage.getItem('cinematch_language');
  if (!savedLanguage) {
    const browserLanguage = detectBrowserLanguage();
    changeLanguage(browserLanguage);
  }
};