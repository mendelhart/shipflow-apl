import { createContext, useContext, useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';

const ThemeContext = createContext();

export function ThemeProvider({ children }) {
  const [settings, setSettings] = useState(null);

  useEffect(() => {
    const loadSettings = async () => {
      const settingsList = await base44.entities.AppSettings.list();
      if (settingsList.length > 0) {
        setSettings(settingsList[0]);
        applyTheme(settingsList[0]);
      }
    };
    loadSettings();
  }, []);

  const applyTheme = (themeSettings) => {
    if (!themeSettings) return;
    const root = document.documentElement;
    root.style.setProperty('--theme-bg', themeSettings.background_color || '#f3f4f6');
    root.style.setProperty('--theme-card', themeSettings.card_background_color || '#ffffff');
    root.style.setProperty('--theme-text', themeSettings.text_color || '#111827');
    root.style.setProperty('--theme-text-secondary', themeSettings.secondary_text_color || '#6b7280');
  };

  return (
    <ThemeContext.Provider value={settings}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}