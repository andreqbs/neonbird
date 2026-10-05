import { formatDecimal, formatSeconds, has, t } from './index';

/**
 * Os textos do que vem do servidor — nome e frase dos passaros e das skins, os
 * encaixes, os poderes —, no idioma do jogo.
 *
 * O servidor manda tudo em portugues (server/catalog.go). Aqui a traducao vem
 * dos arquivos de idioma, pelo id; os NUMEROS dos poderes continuam vindo do
 * servidor, entao mudar um tempo la muda a frase em todos os idiomas. Item que
 * o servidor mande e os arquivos ainda nao conhecam aparece com o texto dele.
 */

const ouServidor = (key, servidor, params) => (has(key) ? t(key, params) : servidor || '');

export const birdName = (bird) => ouServidor(`birds.${bird.id}.name`, bird.name);
export const birdTagline = (bird) => ouServidor(`birds.${bird.id}.tagline`, bird.tagline);

export const skinName = (skin) => ouServidor(`skins.${skin.id}.name`, skin.name);
export const skinTagline = (skin) => ouServidor(`skins.${skin.id}.tagline`, skin.tagline);
export const slotName = (slot) => ouServidor(`skinSlots.${slot.id}`, slot.name);

export const stageName = (stage) => ouServidor(`stages.${stage.id}`, stage.name);

/**
 * O tempo ligado de um poder com estrelas: o do nivel de partida e, entre
 * parenteses, o das cinco estrelas.
 */
function tempoLigado(power) {
  const valores = power.levelValues;
  const params = power.params || {};
  if (Array.isArray(valores) && valores.length > 1) {
    return {
      on: formatSeconds(valores[0]),
      stars: t('powers.stars', { max: formatSeconds(valores[valores.length - 1]) }),
    };
  }
  return { on: formatSeconds(params.activeSeconds), stars: '' };
}

/** Nome e frase de um poder, montados com os numeros que o servidor mandou. */
export function powerText(power) {
  const params = power.params || {};
  switch (power.id) {
    case 'magnet':
    case 'ghost': {
      const { on, stars } = tempoLigado(power);
      return {
        name: t(`powers.${power.id}.name`),
        description: t(`powers.${power.id}.desc`, {
          on,
          stars,
          cooldown: formatSeconds(params.cooldownSeconds),
        }),
      };
    }
    case 'slow': {
      const { on, stars } = tempoLigado(power);
      return {
        name: t('powers.slow.name'),
        description: t('powers.slow.desc', {
          on,
          stars,
          percent: formatDecimal(params.percent),
          cooldown: formatSeconds(params.cooldownSeconds),
        }),
      };
    }
    case 'extraChance': {
      const count = Math.max(1, Math.round(params.extra || 1));
      const video = params.videoOnly ? 'Video' : '';
      return {
        name: count === 1 ? t('powers.extraChance.name') : t('powers.extraChance.nameMany', { count }),
        description:
          count === 1
            ? t(`powers.extraChance.desc${video}`)
            : t(`powers.extraChance.descMany${video}`, { count }),
      };
    }
    case 'coinMultiplier': {
      const count = Math.max(1, Math.round(params.multiplier || 1));
      return {
        name: count === 2 ? t('powers.coinMultiplier.name') : t('powers.coinMultiplier.nameMany', { count }),
        description:
          count === 2 ? t('powers.coinMultiplier.desc') : t('powers.coinMultiplier.descMany', { count }),
      };
    }
    default:
      // Poder novo que os arquivos de idioma ainda nao conhecem: o texto do servidor.
      return { name: power.name || '', description: power.description || '' };
  }
}
