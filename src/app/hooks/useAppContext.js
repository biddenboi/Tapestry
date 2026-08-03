import { useContext } from 'react';
import { AppContext } from '@app/context/AppContext.js';

export function useAppContext() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useAppContext must be used within AppContext.Provider.');
  }
  return context;
}
