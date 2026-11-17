import en from './en.json';
import ko from './ko.json';

export const SITE_NAME = 'Booki Choi';
export const SITE_NAME_KO = 'TODO: 내 확인 필요'; // 한글 표기 미확인
export const LANGS = ['en', 'ko'] as const;
export type Lang = (typeof LANGS)[number];
export const getT = (lang: Lang) => (lang === 'ko' ? ko : en);
