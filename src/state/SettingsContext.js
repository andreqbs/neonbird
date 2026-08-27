import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = '@neon-flyer/settings';

export const DEFAULT_SETTINGS = {
  music: true, // trilha de fundo em loop
  flapSound: true, // som do toque que faz o passaro subir
  effects: true, // ponto e colisao
};

const SettingsContext = createContext({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  setSetting: () => {},
});

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(KEY)
      .then((raw) => {
        if (!alive) return;
        if (raw) {
          try {
            // Mescla com os padroes: uma chave nova numa versao futura do app
            // nao quebra quem ja tem preferencias salvas.
            setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(raw) });
          } catch (e) {
            // preferencias corrompidas: segue com os padroes
          }
        }
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
    return () => {
      alive = false;
    };
  }, []);

  const setSetting = useCallback((key, value) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const value = useMemo(() => ({ settings, loaded, setSetting }), [settings, loaded, setSetting]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  return useContext(SettingsContext);
}
