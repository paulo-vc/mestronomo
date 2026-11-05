// Atalhos de teclado globais, configuráveis (funcionam com o app em segundo plano).

export type HotkeyAction =
  | { tipo: 'som'; id: string }
  | { tipo: 'somPosicao'; n: number }
  | { tipo: 'cena'; id: string }
  | { tipo: 'momento'; dir: 'proximo' | 'anterior' }
  | { tipo: 'filtro'; nome: 'abafado' | 'caverna' | 'eco' }
  | { tipo: 'player'; cmd: 'pausar' | 'proxima' }
  | { tipo: 'turno' }
  | { tipo: 'pararEfeitos' }
  | { tipo: 'bot' };

export interface Hotkey {
  /** Combinação no formato do Electron, ex.: "Control+Alt+1", "Shift+F5". */
  tecla: string;
  acao: HotkeyAction;
}

/** O de sempre: Ctrl+Alt+1..9 tocam os nove primeiros sons e Ctrl+Alt+0 para os efeitos. */
export const DEFAULT_HOTKEYS: Hotkey[] = [
  ...Array.from({ length: 9 }, (_, i) => ({ tecla: `Control+Alt+${i + 1}`, acao: { tipo: 'somPosicao', n: i + 1 } as HotkeyAction })),
  { tecla: 'Control+Alt+0', acao: { tipo: 'pararEfeitos' } },
];

const MODIFICADORES = ['Control', 'Alt', 'Shift', 'Super'];

/**
 * Valida uma combinação: precisa de um modificador (Ctrl, Alt, Shift) ou ser uma tecla F —
 * um atalho global numa letra solta roubaria essa letra do Windows inteiro.
 */
export function validateAccelerator(tecla: string): string | undefined {
  const partes = tecla.split('+').filter(Boolean);
  if (partes.length === 0) return 'Atalho vazio.';
  const principal = partes[partes.length - 1];
  if (MODIFICADORES.includes(principal)) return 'Falta a tecla principal (só tem Ctrl/Alt/Shift).';
  const temModificador = partes.slice(0, -1).some((p) => MODIFICADORES.includes(p));
  if (!temModificador && !/^F([1-9]|1[0-9]|2[0-4])$/.test(principal)) return `Use Ctrl, Alt ou Shift junto com "${principal}" (só as teclas F funcionam sozinhas).`;
  return undefined;
}

export interface RegisterResult {
  /** Teclas que não puderam ser registradas (inválidas, repetidas ou usadas por outro programa). */
  falhas: { indice: number; tecla: string; motivo: string }[];
}

/**
 * Registra a lista. `register` é o globalShortcut.register do Electron (injetado para teste);
 * devolve false quando outro programa já usa a tecla.
 */
export function registerHotkeys(
  lista: Hotkey[],
  executar: (acao: HotkeyAction) => void,
  register: (tecla: string, fn: () => void) => boolean,
): RegisterResult {
  const falhas: RegisterResult['falhas'] = [];
  const usadas = new Set<string>();
  for (const [indice, { tecla, acao }] of lista.entries()) {
    const invalida = validateAccelerator(tecla);
    if (invalida) {
      falhas.push({ indice, tecla, motivo: invalida });
      continue;
    }
    if (usadas.has(tecla)) {
      falhas.push({ indice, tecla, motivo: 'Repetida na lista.' });
      continue;
    }
    usadas.add(tecla);
    let ok = false;
    try {
      ok = register(tecla, () => executar(acao));
    } catch {
      ok = false;
    }
    if (!ok) falhas.push({ indice, tecla, motivo: 'Outro programa já usa esta combinação.' });
  }
  return { falhas };
}
