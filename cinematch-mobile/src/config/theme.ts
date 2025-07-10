import { DefaultTheme } from 'react-native-paper';

export const theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: '#6200ee',
    accent: '#03dac6',
    background: '#121212',
    surface: '#1e1e1e',
    text: '#ffffff',
    placeholder: '#888888',
    backdrop: 'rgba(0, 0, 0, 0.5)',
  },
  dark: true,
};

export const colors = {
  primary: '#6200ee',
  secondary: '#03dac6',
  background: '#121212',
  surface: '#1e1e1e',
  text: '#ffffff',
  textSecondary: '#b3b3b3',
  border: '#333333',
  error: '#cf6679',
  success: '#4caf50',
  warning: '#ff9800',
};