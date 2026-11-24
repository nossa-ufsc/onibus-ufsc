import type { Campus } from '../campi';
import type { Linha } from '../lib/types';

export type PontoCampus = { id: string; nome: string; lat: number; lon: number };

/** O que todo coletor devolve: linhas do campus (sem hash/alteradaEm, que são calculados depois) e pontos. */
export interface Coleta {
  linhas: Omit<Linha, 'hash' | 'alteradaEm'>[];
  pontos: PontoCampus[];
}

/** `hoje` = AAAA-MM-DD em America/Sao_Paulo. */
export type Coletor = (campus: Campus, hoje: string) => Promise<Coleta>;
