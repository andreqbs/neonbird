import ar from './locales/ar.json';
import de from './locales/de.json';
import en from './locales/en.json';
import es from './locales/es.json';
import fr from './locales/fr.json';
import it from './locales/it.json';
import ja from './locales/ja.json';
import pt from './locales/pt.json';
import ru from './locales/ru.json';
import zh from './locales/zh.json';

/**
 * O idioma do jogo.
 *
 * Os textos moram em arquivos de traducao, um por idioma (locales/*.json), todos
 * com as MESMAS chaves. A tela pede `t('home.play')` e recebe o texto do idioma
 * em uso. Chave que faltar no idioma cai no ingles; se faltar ate no ingles, no
 * portugues — e so entao aparece a propria chave. O `npm test` confere que os
 * dez arquivos tem todas as chaves, com os mesmos {marcadores}.
 *
 * QUAL IDIOMA: o que o jogador escolheu em Configuracoes. Sem escolha
 * ("automatico"), o do celular, se for um dos dez — senao, ou se a leitura
 * falhar, o ingles.
 *
 * Plural sem biblioteca: o texto vira um objeto com uma forma por categoria —
 * `{ one, other }` na maioria; o russo tem few e many; o arabe, zero, two, few e
 * many; chines e japones, so `other`. A regra de cada idioma e `pluralCategory`.
 *
 * O arabe sai com o texto da direita para a esquerda (o proprio texto cuida
 * disso), mas a tela nao espelha: espelhar pede reiniciar o app e inverteria
 * tambem o jogo, que voa da esquerda para a direita.
 */

export const LANGUAGES = [
  { code: 'pt', name: 'Português' },
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Español' },
  { code: 'it', name: 'Italiano' },
  { code: 'de', name: 'Deutsch' },
  { code: 'fr', name: 'Français' },
  { code: 'ru', name: 'Русский' },
  { code: 'zh', name: '中文' },
  { code: 'ja', name: '日本語' },
  { code: 'ar', name: 'العربية' },
];

/** O idioma de reserva: celular em idioma que o jogo nao tem, ou leitura que falhou. */
export const DEFAULT_LANGUAGE = 'en';

/** O valor da preferencia que segue o idioma do celular. */
export const AUTO = 'auto';

const DICTIONARIES = { pt, en, es, it, de, fr, ru, zh, ja, ar };

// A etiqueta completa de cada idioma, para datas e numeros do sistema. O arabe
// pede algarismos latinos (u-nu-latn), os mesmos do resto do jogo.
const LOCALE_TAGS = {
  pt: 'pt-BR',
  en: 'en-US',
  es: 'es-ES',
  it: 'it-IT',
  de: 'de-DE',
  fr: 'fr-FR',
  ru: 'ru-RU',
  zh: 'zh-CN',
  ja: 'ja-JP',
  ar: 'ar-u-nu-latn',
};

let current = null; // o idioma em uso; null = ainda nao decidido
const listeners = new Set();

// ------------------------------------------------------------------- detectar

/** 'pt-BR', 'zh_Hant_TW', 'EN' → o codigo de um dos dez idiomas, ou null. */
export function matchLanguage(tag) {
  if (typeof tag !== 'string') return null;
  const code = tag.trim().toLowerCase().split(/[-_]/)[0];
  return Object.prototype.hasOwnProperty.call(DICTIONARIES, code) ? code : null;
}

/**
 * Os idiomas do celular, na ordem de preferencia do dono. O modulo nativo pode
 * nao existir (build antiga, testes no Node): ai vale o que o motor de
 * JavaScript sabe, e no fim nada.
 */
function deviceLanguageTags() {
  try {
    const { getLocales } = require('expo-localization');
    const tags = (getLocales() || [])
      .map((l) => l && (l.languageCode || l.languageTag))
      .filter(Boolean);
    if (tags.length > 0) return tags;
  } catch (e) {
    // sem o modulo nativo: segue para o plano B
  }
  try {
    const tag = Intl.DateTimeFormat().resolvedOptions().locale;
    if (tag) return [tag];
  } catch (e) {
    // sem Intl: segue para o ingles
  }
  return [];
}

/**
 * O idioma do celular: o primeiro da lista de preferencias que o jogo tem.
 * Nenhum deles, ou a leitura falhou: ingles.
 */
export function detectDeviceLanguage(tags = deviceLanguageTags()) {
  for (const tag of tags || []) {
    const code = matchLanguage(tag);
    if (code) return code;
  }
  return DEFAULT_LANGUAGE;
}

/** A preferencia salva ('auto' ou um codigo) → o idioma que vale. */
export function resolveLanguage(preference) {
  return matchLanguage(preference) || detectDeviceLanguage();
}

// ------------------------------------------------------------------- escolher

export function getLanguage() {
  if (!current) current = detectDeviceLanguage();
  return current;
}

/** Troca o idioma; quem assina (a raiz do app) redesenha as telas. */
export function setLanguage(code) {
  const next = matchLanguage(code) || DEFAULT_LANGUAGE;
  if (next === current) return;
  current = next;
  for (const listener of listeners) listener(next);
}

export function subscribeLanguage(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** A etiqueta do idioma em uso para datas do sistema ('pt-BR', 'ja-JP'...). */
export function localeTag(code = getLanguage()) {
  return LOCALE_TAGS[code] || LOCALE_TAGS[DEFAULT_LANGUAGE];
}

/** O nome de um idioma, escrito nele mesmo ('Español', '日本語'). */
export function languageName(code) {
  const l = LANGUAGES.find((x) => x.code === code);
  return l ? l.name : code;
}

// --------------------------------------------------------------------- textos

const PLURAL_FORMS = ['zero', 'one', 'two', 'few', 'many', 'other'];

function lookup(code, key) {
  let node = DICTIONARIES[code];
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object' || Array.isArray(node)) return undefined;
    node = node[part];
  }
  return node;
}

/** Um objeto so de formas de plural ({ one, other }) e um texto, nao um grupo. */
export function isPluralNode(node) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return false;
  const keys = Object.keys(node);
  return keys.length > 0 && keys.every((k) => PLURAL_FORMS.includes(k));
}

/** A categoria de plural de `n` no idioma (as regras do CLDR, so as que o jogo usa). */
export function pluralCategory(code, n) {
  const i = Math.floor(Math.abs(Number(n) || 0));
  switch (code) {
    case 'zh':
    case 'ja':
      return 'other';
    case 'fr':
      return i === 0 || i === 1 ? 'one' : 'other';
    case 'ru': {
      const d = i % 10;
      const c = i % 100;
      if (d === 1 && c !== 11) return 'one';
      if (d >= 2 && d <= 4 && (c < 12 || c > 14)) return 'few';
      return 'many';
    }
    case 'ar': {
      const c = i % 100;
      if (i === 0) return 'zero';
      if (i === 1) return 'one';
      if (i === 2) return 'two';
      if (c >= 3 && c <= 10) return 'few';
      if (c >= 11 && c <= 99) return 'many';
      return 'other';
    }
    default:
      // pt, en, es, it, de: so o 1 e singular ("0 moedas")
      return i === 1 ? 'one' : 'other';
  }
}

function interpolate(text, params) {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (marca, nome) =>
    params[nome] === undefined || params[nome] === null ? marca : String(params[nome])
  );
}

/** O valor da chave e o idioma de onde ele veio (o em uso, o ingles ou o portugues). */
function resolve(key) {
  for (const code of [getLanguage(), DEFAULT_LANGUAGE, 'pt']) {
    const value = lookup(code, key);
    if (value !== undefined && (typeof value === 'string' || isPluralNode(value) || Array.isArray(value))) {
      return { value, code };
    }
  }
  return null;
}

/**
 * O texto da chave no idioma em uso, com os {marcadores} preenchidos. Texto com
 * plural escolhe a forma pelo `count`.
 */
export function t(key, params) {
  const achado = resolve(key);
  if (!achado) return key;
  let { value } = achado;
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') {
    const forma = pluralCategory(achado.code, params && params.count);
    value = value[forma] ?? value.other ?? '';
  }
  return interpolate(value, params);
}

/** A lista da chave (os meses, por exemplo), ou [] se nao for lista. */
export function tList(key) {
  const achado = resolve(key);
  return achado && Array.isArray(achado.value) ? achado.value : [];
}

/** Existe texto para esta chave (no idioma em uso ou na reserva)? */
export function has(key) {
  return resolve(key) !== null;
}

// -------------------------------------------------------------------- numeros

/** 2.5 → "2,5" ou "2.5", conforme o idioma. */
export function formatDecimal(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return String(n).replace('.', t('number.decimal'));
}

/** 2.5 → "2,5 s", "2.5秒"... */
export function formatSeconds(value) {
  return t('time.seconds', { n: formatDecimal(value) });
}

// ---------------------------------------------------------------------- erros

/**
 * O texto de um erro para o jogador ler.
 *
 * O servidor responde em portugues e com um codigo (`not_enough_coins`). Em
 * portugues, vale o texto dele, que e o mais especifico; nos outros idiomas,
 * a traducao do codigo — e, para codigo que o app nao conhece, um aviso
 * generico, nunca uma frase em portugues.
 */
export function errorText({ code, error } = {}) {
  if (getLanguage() === 'pt' && error) return error;
  if (code && has(`errors.${code}`)) return t(`errors.${code}`);
  return t('errors.generic');
}

export default {
  LANGUAGES,
  DEFAULT_LANGUAGE,
  AUTO,
  matchLanguage,
  detectDeviceLanguage,
  resolveLanguage,
  getLanguage,
  setLanguage,
  subscribeLanguage,
  localeTag,
  languageName,
  t,
  tList,
  has,
  formatDecimal,
  formatSeconds,
  errorText,
  pluralCategory,
  isPluralNode,
};
