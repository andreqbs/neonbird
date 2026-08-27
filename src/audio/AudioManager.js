import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { DEFAULT_SETTINGS } from '../state/SettingsContext';

const SOURCES = {
  flap: require('../../assets/audio/flap.wav'),
  score: require('../../assets/audio/score.wav'),
  hit: require('../../assets/audio/hit.wav'),
  music: require('../../assets/audio/music.wav'),
};

const MUSIC_VOLUME = 0.32;
const FLAP_VOLUME = 0.55;
const FX_VOLUME = 0.7;

// O toque pode se repetir mais rapido do que o som dura. Com um unico player
// cada toque cortaria o anterior, entao usamos um rodizio curto.
const FLAP_VOICES = 3;

/**
 * Camada de audio do jogo. Fica fora do React de proposito: o game loop chama
 * `flap()` dezenas de vezes por partida e nao deveria disparar re-render nenhum.
 *
 * Toda chamada e tolerante a falha — se o audio nao carregar (emulador sem
 * saida, permissao negada, plataforma sem suporte), o jogo continua mudo em vez
 * de quebrar.
 */
class AudioManager {
  constructor() {
    this.settings = DEFAULT_SETTINGS;
    this.ready = false;
    this.flapVoices = [];
    this.flapIndex = 0;
    this.scorePlayer = null;
    this.hitPlayer = null;
    this.music = null;
    this.musicWanted = false;
    this.musicPlaying = false;
    this.musicTimer = null;
    this.suspended = false;
  }

  async init() {
    if (this.ready) return;
    this.ready = true;

    try {
      await setAudioModeAsync({
        playsInSilentMode: true,
        shouldPlayInBackground: false,
        interruptionMode: 'mixWithOthers',
      });
    } catch (e) {
      // sem sessao de audio configuravel neste ambiente: segue mesmo assim
    }

    try {
      for (let i = 0; i < FLAP_VOICES; i++) {
        const p = createAudioPlayer(SOURCES.flap);
        p.volume = FLAP_VOLUME;
        this.flapVoices.push(p);
      }
      this.scorePlayer = createAudioPlayer(SOURCES.score);
      this.scorePlayer.volume = FX_VOLUME;

      this.hitPlayer = createAudioPlayer(SOURCES.hit);
      this.hitPlayer.volume = FX_VOLUME;

      this.music = createAudioPlayer(SOURCES.music);
      this.music.loop = true;
      this.music.volume = MUSIC_VOLUME;
    } catch (e) {
      this.flapVoices = [];
      this.scorePlayer = null;
      this.hitPlayer = null;
      this.music = null;
    }

    this._syncMusic();
  }

  /** Recebe as preferencias do usuario; chamado sempre que elas mudam. */
  configure(settings) {
    this.settings = settings;
    this._syncMusic();
  }

  /** Silencia tudo quando o app sai da frente, sem perder o estado. */
  setSuspended(suspended) {
    this.suspended = suspended;
    this._syncMusic();
  }

  /** Liga/desliga a trilha; a preferencia do usuario ainda tem a palavra final. */
  setMusicWanted(wanted) {
    this.musicWanted = wanted;
    this._syncMusic();
  }

  playFlap() {
    if (!this.settings.flapSound) return;
    const voice = this.flapVoices[this.flapIndex];
    if (!voice) return;
    this.flapIndex = (this.flapIndex + 1) % this.flapVoices.length;
    this._restart(voice);
  }

  playScore() {
    if (!this.settings.effects) return;
    this._restart(this.scorePlayer);
  }

  playHit() {
    if (!this.settings.effects) return;
    this._restart(this.hitPlayer);
  }

  _restart(player) {
    if (!player) return;
    try {
      // seekTo e assincrono, mas a chamada seguinte ja entra na fila nativa;
      // esperar aqui adicionaria latencia audivel no toque.
      player.seekTo(0)?.catch?.(() => {});
      player.play();
    } catch (e) {
      // player ainda carregando ou ja liberado
    }
  }

  /**
   * Estado da trilha e resultado de tres coisas que mudam em momentos
   * diferentes (preferencia, tela atual, app em foco), e cada mudanca chegava
   * aqui como um play/pause solto. Alternar os dois rapido faz o player
   * cancelar o proprio play e cuspir um erro, entao juntamos as chamadas numa
   * so e aplicamos apenas quando o alvo muda de verdade.
   */
  _syncMusic() {
    if (!this.music) return;
    if (this.musicTimer) clearTimeout(this.musicTimer);
    this.musicTimer = setTimeout(() => {
      this.musicTimer = null;
      this._applyMusic();
    }, 60);
  }

  _applyMusic() {
    if (!this.music) return;
    const shouldPlay = this.musicWanted && this.settings.music && !this.suspended;
    if (shouldPlay === this.musicPlaying) return;
    this.musicPlaying = shouldPlay;
    try {
      if (shouldPlay) this.music.play();
      else this.music.pause();
    } catch (e) {
      // player nao pronto ou ja liberado
    }
  }
}

export default new AudioManager();
