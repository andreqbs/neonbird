import { t } from '../i18n';

/**
 * Tempo de voo para a tela: curto e sem zero inutil na frente (no idioma do
 * jogo — o formato de cada um mora nos arquivos de traducao).
 *
 *   45s · 12min 05s · 3h 07min
 *
 * Com horas, os segundos saem: ninguem conta segundo de quem ja voou tres horas.
 */
export function formatFlightTime(ms) {
  const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const horas = Math.floor(total / 3600);
  const minutos = Math.floor((total % 3600) / 60);
  const segundos = total % 60;
  const dois = (n) => String(n).padStart(2, '0');

  if (horas > 0) return t('time.flightH', { h: horas, mm: dois(minutos) });
  if (minutos > 0) return t('time.flightM', { m: minutos, ss: dois(segundos) });
  return t('time.flightS', { s: segundos });
}
