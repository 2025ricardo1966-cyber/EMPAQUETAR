import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { t as catalogT, DEFAULT_LANGUAGE } from '../../../i18n';
import { resolveUiLanguage } from '../../foundation/language';

type Vars = Record<string, string | number | boolean | null | undefined>;

type I18nValue = {
  language: string;
  setLanguage: (lang: string) => void;
  t: (key: string, vars?: Vars) => string;
};

const I18nContext = createContext<I18nValue | null>(null);

export const I18nProvider: React.FC<{ children: React.ReactNode; initialLanguage?: string }> = ({
  children,
  initialLanguage,
}) => {
  const [language, setLanguage] = useState(
    () =>
      initialLanguage ||
      resolveUiLanguage({
        browserLanguage: typeof navigator !== 'undefined' ? navigator.language : undefined,
      })
  );
  const t = useCallback((key: string, vars?: Vars) => catalogT(key, language, vars), [language]);
  const value = useMemo(() => ({ language, setLanguage, t }), [language, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    return {
      language: DEFAULT_LANGUAGE,
      setLanguage: () => undefined,
      t: (key, vars) => catalogT(key, DEFAULT_LANGUAGE, vars),
    };
  }
  return ctx;
}
