// Dias em que o transporte opera com outro quadro. O site do Fênix tem uma tabela disso
// (OPERACOES), mas ela parou em 2019 — então calculamos: feriados nacionais e de Florianópolis
// rodam como domingo; vésperas de Natal/Ano-Novo e segunda de Carnaval rodam como sábado
// (padrão que aparece na própria tabela antiga do Fênix).

import type { TipoDia } from './types';

function pascoa(ano: number): Date {
  // algoritmo de Meeus/Jones/Butcher
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(ano, mes - 1, dia));
}
const iso = (d: Date) => d.toISOString().slice(0, 10);
const somaDias = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

export function diasEspeciais(anos: number[]): Record<string, TipoDia> {
  const out: Record<string, TipoDia> = {};
  for (const ano of anos) {
    const fixos: [string, TipoDia][] = [
      ['01-01', 'domingo'], ['03-23', 'domingo'] /* aniversário de Florianópolis */, ['04-21', 'domingo'],
      ['05-01', 'domingo'], ['09-07', 'domingo'], ['10-12', 'domingo'], ['11-02', 'domingo'],
      ['11-15', 'domingo'], ['11-20', 'domingo'], ['12-25', 'domingo'],
      ['12-24', 'sabado'], ['12-31', 'sabado'],
    ];
    for (const [md, tipo] of fixos) out[`${ano}-${md}`] = tipo;
    const p = pascoa(ano);
    out[iso(somaDias(p, -48))] = 'sabado';   // segunda de Carnaval
    out[iso(somaDias(p, -47))] = 'domingo';  // terça de Carnaval
    out[iso(somaDias(p, -2))] = 'domingo';   // Sexta-feira Santa
    out[iso(somaDias(p, 60))] = 'domingo';   // Corpus Christi
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}
