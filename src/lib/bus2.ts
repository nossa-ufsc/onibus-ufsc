// Cliente da API aberta do Bus2/Mobilibus (https://cdn.bus2.studio/api), a mesma que alimenta as
// tabelas públicas das operadoras. Sem chave; respostas com cache de CDN (~1 h). Não documentada:
// qualquer formato inesperado lança erro e a coleta falha em vez de gravar dado ruim.

import type { LonLat } from './geo';

const API = 'https://cdn.bus2.studio/api';
const UA = 'Mozilla/5.0 (compatible; nossa-ufsc-onibus/1.0; +https://github.com/nossa-ufsc/onibus-ufsc)';

export interface Rota {
  routeId: string;
  shortName: string | null;
  longName: string;
  desc: string | null;
  color: string;
  textColor: string;
  price: number | null;
}
export interface Partida { dep: string; arr: string | null; wa: number; extra: boolean; seq: number }
export interface Servico { serviceId: string; desc: string; start: string; end: string; days: boolean[]; departures: Partida[] }
export interface Sentido { directionId: number; desc: string; services: Servico[] }
export interface Viagem { tripId: string; tripDesc: string; headsign: string; directionId: number; seq: number }
export interface Tabela { directions: Sentido[]; trips: Viagem[]; exceptions: unknown[] }
export interface Parada { stopId: string; lat: number; lng: number; name: string; int: number }
export interface DetalheViagem { tripName: string; shape: string; stops: Parada[] }

async function get<T>(caminho: string): Promise<T> {
  let erro: unknown;
  for (let t = 1; t <= 3; t++) {
    try {
      const res = await fetch(`${API}/${caminho}`, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(45_000) });
      if (res.ok) return (await res.json()) as T;
      erro = new Error(`${caminho} -> HTTP ${res.status}`);
      if (res.status < 500 && res.status !== 429) break;
    } catch (e) {
      erro = e;
    }
    await Bun.sleep(3_000 * t);
  }
  throw erro instanceof Error ? erro : new Error(String(erro));
}

export async function rotas(projeto: string): Promise<Rota[]> {
  const r = await get<Rota[]>(`routes?project_hash=${projeto}`);
  if (!Array.isArray(r) || !r.length) throw new Error(`Projeto ${projeto} sem linhas na API`);
  return r;
}

export async function tabela(rota: string): Promise<Tabela | null> {
  const r = await get<{ timetable?: Tabela } | ''>(`timetable?v=2&route_hash=${rota}`).catch((e) => {
    // linha sem quadro cadastrado responde corpo vazio
    if (e instanceof SyntaxError) return '' as const;
    throw e;
  });
  if (!r || !r.timetable) return null;
  if (!Array.isArray(r.timetable.directions) || !Array.isArray(r.timetable.trips)) throw new Error(`Tabela de ${rota} fora do formato`);
  return r.timetable;
}

export async function detalheViagem(viagem: string): Promise<DetalheViagem> {
  const d = await get<DetalheViagem>(`trip-details?v=2&trip_hash=${viagem}`);
  if (typeof d?.shape !== 'string' || !Array.isArray(d.stops)) throw new Error(`Viagem ${viagem} fora do formato`);
  return d;
}

/** Polilinha codificada do Google → [lon, lat]. Bus2 usa precisão 5; o onibus.info, 6. */
export function decodificar(s: string, precisao = 5): LonLat[] {
  const f = 10 ** precisao;
  const out: LonLat[] = [];
  let i = 0, lat = 0, lon = 0;
  const num = () => {
    let r = 0, sh = 0, b: number;
    do {
      b = s.charCodeAt(i++) - 63;
      r |= (b & 0x1f) << sh;
      sh += 5;
    } while (b >= 0x20);
    return r & 1 ? ~(r >> 1) : r >> 1;
  };
  while (i < s.length) {
    lat += num();
    lon += num();
    out.push([lon / f, lat / f]);
  }
  return out;
}
