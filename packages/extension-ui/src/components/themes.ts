// Copyright 2019-2022 @polkadot/extension-ui authors & contributors
// SPDX-License-Identifier: Apache-2.0

const darkTheme = {
  accountDotsIconColor: '#8E8E8E',
  addAccountImageBackground: '#1A1B20',
  backButtonBackground: '#3A3B41', // SEL
  backButtonBackgroundHover: '#3a3b41ad',
  backButtonTextColor: '#FFFFFF',
  background: '#26272C',
  bodyColor: '#20222A',
  borderRadius: '4px',
  boxBackground: '#1A1B20',
  boxBorderColor: '#303030',
  boxLineHeight: '1rem',
  boxMargin: '0.75rem 0',
  boxPadding: '0 0.25rem',
  boxShadow: 'rgba(0, 0, 0, 0.86)',
  buttonBackground: '#35a7f2',
  buttonBackgroundDanger: '#AF1111',
  buttonBackgroundDangerHover: '#D93B3B',
  buttonBackgroundHover: '#29afed', // Sel
  buttonTextColor: '#FFFFFF',
  connectedDotColor: 'seagreen',
  errorBorderColor: '#7E3530',
  errorColor: '#E42F2F',
  fontFamily: 'Nunito, sans-serif',
  fontSize: '16px',
  highlightedAreaBackground: '#212226',
  iconDangerColor: '#AF1111',
  iconNeutralColor: '#8E8E8E',
  iconWarningColor: '#03A9F4',
  id: 'dark',
  identiconBackground: '#F4F5F8',
  inputBackground: '#111218',
  inputBorderColor: '#43444B',
  inputLabelFontSize: '10px',
  labelColor: '#9F9E99',
  labelFontSize: '13px',
  labelLineHeight: '18px',
  lineHeight: '26px',
  parentLabelColor: '#4A7463',
  popupBackground: '#38393F',
  primaryColor: '#03A9F4',
  readonlyInputBackground: '#1A1B20',
  subTextColor: '#DDD',
  textColor: '#FFFFFF',
  textColorDanger: '#FF8686'
};

export declare type Theme = typeof darkTheme;

const lightTheme: Theme = {
  ...darkTheme,
  addAccountImageBackground: '#FFF',
  backButtonBackground: '#D7D7D7',
  backButtonBackgroundHover: '#d7d7d7ad',
  backButtonTextColor: '#454545',
  background: '#FAFAFA',
  bodyColor: '#FFFFFF',
  boxBackground: '#FFFFFF',
  boxBorderColor: '#DADFEA',
  boxShadow: 'rgba(0, 0, 0, 0.3)',
  buttonBackgroundDanger: '#DC2222',
  errorBorderColor: '#E42F2F',
  highlightedAreaBackground: '#EFEFEF',
  iconDangerColor: '#DC2222',
  iconNeutralColor: '#939CB1',
  id: 'light',
  inputBackground: '#FFFFFF',
  inputBorderColor: '#DDE1EB',
  labelColor: '#333333',
  parentLabelColor: '#215B4F',
  popupBackground: '#FFFFFF',
  readonlyInputBackground: '#FFF',
  subTextColor: '#454545',
  textColor: '#242529',
  textColorDanger: '#F24A4A'
};

export const themes = {
  dark: darkTheme,
  light: lightTheme
};

export declare type AvailableThemes = keyof typeof themes;

export function chooseTheme (): AvailableThemes {
  const preferredTheme = localStorage.getItem('theme');

  if (preferredTheme) {
    return preferredTheme === 'dark'
      ? 'dark'
      : 'light';
  }

  return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches
    ? 'light'
    : 'dark';
}
