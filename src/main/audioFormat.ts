// Formato de áudio interno: o mesmo que o Discord usa (48 kHz, estéreo, quadros de 20 ms).
// Fica num módulo próprio para o mixer e os filtros usarem sem importação circular.

export const SAMPLE_RATE = 48_000;
export const CHANNELS = 2;
/** 20 ms por quadro — o ritmo em que o Discord consome áudio. */
export const FRAME_MS = 20;
export const FRAME_SAMPLES = (SAMPLE_RATE / 1000) * FRAME_MS;
export const FRAME_VALUES = FRAME_SAMPLES * CHANNELS;
export const FRAME_BYTES = FRAME_VALUES * 2;
