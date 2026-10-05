import { useEffect, useState } from 'react';

import { getLanguage, subscribeLanguage } from './index';

/**
 * O idioma em uso, para quem precisa redesenhar quando ele muda. Quem assina e
 * a raiz do app (App.js): na troca, as telas montam de novo ja no idioma novo.
 */
export default function useLanguage() {
  const [lang, setLang] = useState(getLanguage);
  useEffect(() => {
    setLang(getLanguage());
    return subscribeLanguage(setLang);
  }, []);
  return lang;
}
