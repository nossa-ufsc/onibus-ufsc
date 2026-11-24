// Utilitários compartilhados pelos coletores.

import { distLL } from './geo';
import type { Ancora } from '../campi';
import type { TipoDia } from './types';

export const limpa = (s: string) => s.replace(/\s+/g, ' ').trim();

export function noCampus(c: { ancoras: Ancora[] }, lat: number, lon: number): boolean {
  return c.ancoras.some((a) => distLL([lon, lat], [a.lon, a.lat]) <= a.raioM);
}

/** Ruas por onde a viagem passa, a partir dos nomes das paradas ("Rua X, 120 - Bairro" → "Rua X"). */
export function itinerarioDeNomes(nomes: string[]): string[] {
  const out: string[] = [];
  for (const n of nomes) {
    const rua = limpa(n.replace(/,.*$/, '').replace(/\s+-\s+.*$/, '').replace(/\s+\d+[\w-]*$/, ''));
    if (rua && out[out.length - 1] !== rua) out.push(rua);
  }
  return out;
}

/** Minutos para ordenar horários; madrugada (< 03h) vai para o fim do dia de operação. */
export function ordemHora(h: string): number {
  const [hh, mm] = h.split(':').map(Number);
  return hh * 60 + mm + (hh < 3 ? 1440 : 0);
}

/** "HH:MM:SS" → segundos desde 00:00. */
export const segundosDe = (h: string) => {
  const [a, b, c = 0] = h.split(':').map(Number);
  return a * 3600 + b * 60 + c;
};

export const TIPOS_DIA: TipoDia[] = ['util', 'sabado', 'domingo'];
