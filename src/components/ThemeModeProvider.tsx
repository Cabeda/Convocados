import React, { createContext, useContext, useMemo, ReactNode } from 'react';
import { useColorScheme } from '../hooks/useColorScheme';
import { PaletteMode } from '@mui/material';

interface ThemeModeContextType {
  mode: PaletteMode;
}

const ThemeModeContext = createContext<ThemeModeContextType>({ mode: 'light' });

interface ThemeModeProviderProps {
  children: ReactNode;
}

export const ThemeModeProvider: React.FC<ThemeModeProviderProps> = ({ children }) => {
  const systemColorScheme = useColorScheme();
  
  // For now, we just use the system preference
  const contextValue = useMemo(() => {
    return { mode: systemColorScheme };
  }, [systemColorScheme]);

  return (
    <ThemeModeContext.Provider value={contextValue}>
      {children}
    </ThemeModeContext.Provider>
  );
};

export const useThemeMode = () => useContext(ThemeModeContext);
