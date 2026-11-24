// Joinville: onibus.info — o sistema de horários, itinerários e tempo real do transporte coletivo da
// cidade (Gidion/Transtusa). API JSON em formato GTFS, sem documentação; responde 403 sem Referer.
//
//   stopsnear?lat&lng      paradas perto de um ponto (com distância)
//   stoproutes/<parada>    linhas e trajetos (shape_id) que param ali
//   routes                 catálogo (nome e cor)
//   routetrips/<linha>     sentido → shape_id
//   timetable/<linha>      partidas por sentido, ponto de saída e serviço (DU / SAB / DOM)
//   shapes/<shape>         desenho (polyline do Google, precisão 6)
//   shapestops/<shape>     paradas em ordem, com distância percorrida (m)
//   stoptimes/<viagem>     horário programado de cada parada da viagem

import { decodificar } from '../lib/bus2';
import { comprimento, simplificar } from '../lib/geo';
import { fetchJson, mapLimitado } from '../lib/http';
import { itinerarioDeNomes, limpa, noCampus, segundosDe } from '../lib/comum';
import type { Quadro, TipoDia, Trajeto } from '../lib/types';
import type { Coleta, Coletor, PontoCampus } from './tipos';

const API = 'https://onibus.info/api';
const HEADERS = { Referer: 'https://onibus.info/' };
const get = <T>(caminho: string) => fetchJson<T>(`${API}/${caminho}`, HEADERS);

interface ParadaPerto { stop_id: string; stop_name: string; stop_lat: string; stop_lon: string; distance: number }
interface LinhaDaParada { route_id: string; shape_id: string; trip_headsign: string }
interface Rota { route_id: string; route_long_name: string }
interface ViagemModelo { route_id: string; direction_id: number; shape_id: string; trip_headsign: string }
interface Partida { trip_id: string; departure_time: string }
interface Sentido {
  direction: string;
  direction_id: string;
  stop_data: { stop_id: string; stop_name: string; stop_sequence: number; service_data: { service_id: string; service_name: string; time_data: Partida[][] }[] }[];
}
interface ParadaDoTrajeto { stop_id: string; stop_name: string; stop_lat: number; stop_lon: number; stop_order: number; shape_dist_traveled: number }
interface HorarioParada { stop_sequence: number; stop_id: string; arrival_time: string; departure_time: string }

const SERVICOS: Record<string, TipoDia> = { DU: 'util', SAB: 'sabado', DOM: 'domingo' };
function tipoDia(id: string, nome: string): TipoDia | null {
  if (SERVICOS[id]) return SERVICOS[id];
  const n = nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (n.startsWith('dia')) return 'util';
  if (n.startsWith('sab')) return 'sabado';
  if (n.startsWith('dom') || n.includes('feriado')) return 'domingo';
  return null;
}

export const coletarOnibusInfo: Coletor = async (c) => {
  // 1) pontos do campus
  const pontos = new Map<string, PontoCampus>();
  for (const a of c.ancoras) {
    for (const p of await get<ParadaPerto[]>(`stopsnear?lat=${a.lat}&lng=${a.lon}`)) {
      const lat = Number(p.stop_lat), lon = Number(p.stop_lon);
      if (p.distance <= a.raioM && noCampus(c, lat, lon)) pontos.set(p.stop_id, { id: p.stop_id, nome: limpa(p.stop_name), lat, lon });
    }
  }
  if (!pontos.size) throw new Error('nenhuma parada perto do campus (stopsnear vazio?)');

  // 2) linhas e trajetos que param no campus
  const trajetosDoCampus = new Map<string, Set<string>>(); // linha → shape_ids
  for (const id of pontos.keys()) {
    for (const r of await get<LinhaDaParada[]>(`stoproutes/${id}`)) {
      if (!trajetosDoCampus.has(r.route_id)) trajetosDoCampus.set(r.route_id, new Set());
      trajetosDoCampus.get(r.route_id)!.add(r.shape_id);
    }
  }
  const catalogo = new Map((await get<Rota[]>('routes')).map((r) => [r.route_id, r]));
  console.log(`[${c.chave}] ${pontos.size} pontos no campus, ${trajetosDoCampus.size} linhas param neles`);

  const out: Coleta = { linhas: [], pontos: [...pontos.values()] };
  const linhas = await mapLimitado([...trajetosDoCampus], 3, async ([codigo, shapes]) => {
    const [viagens, sentidos] = await Promise.all([
      get<ViagemModelo[]>(`routetrips/${codigo}`),
      get<Sentido[]>(`timetable/${codigo}`),
    ]);
    const quadros: Quadro[] = [];
    const trajetos: Trajeto[] = [];
    let itinerario: string[] = [];

    for (const v of viagens.filter((x) => shapes.has(x.shape_id))) {
      const sentido = sentidos.find((s) => Number(s.direction_id) === v.direction_id);
      const saida = sentido?.stop_data.sort((a, b) => a.stop_sequence - b.stop_sequence)[0];
      if (!sentido || !saida) continue;
      // mais de um desenho no mesmo sentido: a tabela não diz qual viagem faz qual; fica o 1º com
      // aviso (não aconteceu nas linhas do Perini em 2026-11)
      if (trajetos.some((t) => t.origens[0] === limpa(saida.stop_name))) {
        console.error(`⚠ [${c.chave}] linha ${codigo}: mais de um trajeto no sentido ${sentido.direction}; usando o primeiro`);
        continue;
      }
      const origem = limpa(saida.stop_name);
      const [paradas, shape] = await Promise.all([
        get<ParadaDoTrajeto[]>(`shapestops/${v.shape_id}`),
        get<string>(`shapes/${v.shape_id}`),
      ]);
      paradas.sort((a, b) => a.stop_order - b.stop_order);

      // horário oficial em cada parada: viagem-modelo de dia útil mais perto do meio-dia
      const partidas = saida.service_data.flatMap((s) => s.time_data.flat().map((t) => ({ ...t, svc: s.service_id })));
      const modelo = [...partidas].sort((a, b) =>
        Number(b.svc === 'DU') - Number(a.svc === 'DU') || Math.abs(segundosDe(a.departure_time) - 43200) - Math.abs(segundosDe(b.departure_time) - 43200))[0];
      const segundos = new Map<string, number>();
      if (modelo) {
        const ht = await get<HorarioParada[]>(`stoptimes/${modelo.trip_id}`);
        const base = segundosDe(ht[0]?.departure_time ?? modelo.departure_time);
        for (const h of ht) {
          let s = segundosDe(h.arrival_time) - base;
          if (s < 0) s += 86400;
          if (!segundos.has(h.stop_id)) segundos.set(h.stop_id, s);
        }
      }

      const desenho = decodificar(shape, 6);
      const inicio = paradas.find((p) => p.stop_id === saida.stop_id)?.shape_dist_traveled ?? 0;
      trajetos.push({
        nome: limpa(v.trip_headsign.replace(/^.*? - (Ida|Volta) para /, '')) || limpa(v.trip_headsign),
        origens: [origem],
        terminal: null,
        comprimentoM: Math.round(Math.max(comprimento(desenho), paradas.at(-1)?.shape_dist_traveled ?? 0)),
        coordenadas: simplificar(desenho, 8),
        // o desenho pode começar antes do ponto de saída (0429 sai da "UFSC Perini", o desenho vem do
        // Allflex): só valem as paradas que a viagem atende, com distância contada a partir da saída
        pontos: paradas
          .filter((p) => pontos.has(p.stop_id) && (!segundos.size || segundos.has(p.stop_id)))
          .map((p) => ({ pontoId: p.stop_id, distanciaM: Math.max(0, Math.round(p.shape_dist_traveled - inicio)), ...(segundos.has(p.stop_id) ? { segundos: segundos.get(p.stop_id)! } : {}) })),
      });
      if (!itinerario.length) itinerario = itinerarioDeNomes(paradas.map((p) => p.stop_name));

      for (const s of saida.service_data) {
        const tipo = tipoDia(s.service_id, s.service_name);
        if (!tipo) {
          console.error(`⚠ [${c.chave}] linha ${codigo}: serviço desconhecido "${s.service_id} ${s.service_name}" ignorado`);
          continue;
        }
        const saidas = s.time_data.flat().map((t) => ({ hora: t.departure_time.slice(0, 5), acessivel: false, previsto: false }));
        if (saidas.length) quadros.push({ tipoDia: tipo, origem, terminal: null, saidas });
      }
    }
    if (!trajetos.some((t) => t.pontos.length)) return null;
    const info = catalogo.get(codigo);
    return {
      codigo,
      nome: limpa(info?.route_long_name ?? codigo),
      url: `https://onibus.info/linhas/${codigo}`,
      caracteristica: null,
      quadros,
      itinerario,
      trajetos,
    };
  });
  out.linhas = linhas.filter((l): l is NonNullable<typeof l> => !!l);
  return out;
};
