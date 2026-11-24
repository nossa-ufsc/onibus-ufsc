// Transforma as linhas do Bus2 no formato DadosOnibus (v1) que o app lê.
//
// Mapeamento:
//   sentido (direction) × variante de trajeto (seq)  →  uma "origem" (aba de saída)
//   serviço (Dias Úteis / Sábados / Domingos, com validade)  →  Quadro por tipo de dia
//   viagem-modelo da variante (trip-details)  →  Trajeto: desenho, comprimento e paradas do campus
//     com distância ao longo do desenho e o tempo OFICIAL desde a saída (`segundos`)

import { comprimento, distLL, distanciasEmOrdem, simplificar, type LonLat } from './geo';
import { decodificar, type DetalheViagem, type Rota, type Servico, type Tabela } from './bus2';
import type { Campus } from '../campi';
import type { Linha, Quadro, TipoDia, Trajeto } from './types';

export type PontoCampus = { id: string; nome: string; lat: number; lon: number };

const TERMINAIS = ['TICEN', 'TITRI', 'TICAN', 'TILAG', 'TIRIO', 'TISAN', 'TIJOR'];
const terminalDe = (s: string) => TERMINAIS.find((t) => s.toUpperCase().includes(t)) ?? null;
const limpa = (s: string) => s.replace(/\s+/g, ' ').trim();

export function noCampus(c: Campus, lat: number, lon: number): boolean {
  return c.ancoras.some((a) => distLL([lon, lat], [a.lon, a.lat]) <= a.raioM);
}

/** Tipos de dia que um serviço cobre (dias = [dom, seg, …, sáb]). */
function tiposDia(s: Servico): TipoDia[] {
  const out: TipoDia[] = [];
  if (s.days.slice(1, 6).some(Boolean)) out.push('util');
  if (s.days[6]) out.push('sabado');
  if (s.days[0]) out.push('domingo');
  return out;
}

/**
 * Por tipo de dia, fica o serviço vigente hoje; sem nenhum vigente, o próximo a entrar em vigor
 * (Blumenau publica janelas de ~3 semanas). Serviços vigentes do mesmo tipo são somados.
 */
function vigentes(servicos: Servico[], hoje: string): Map<TipoDia, Servico[]> {
  const por = new Map<TipoDia, Servico[]>();
  for (const s of servicos) for (const t of tiposDia(s)) por.set(t, [...(por.get(t) ?? []), s]);
  const out = new Map<TipoDia, Servico[]>();
  for (const [t, lista] of por) {
    const agora = lista.filter((s) => s.start <= hoje && hoje <= s.end);
    if (agora.length) out.set(t, agora);
    else {
      const futuros = lista.filter((s) => s.start > hoje).sort((a, b) => a.start.localeCompare(b.start));
      if (futuros.length) out.set(t, futuros.filter((s) => s.start === futuros[0].start));
    }
  }
  return out;
}

/** Ruas por onde a viagem passa, a partir dos nomes das paradas ("Rua X, 120" → "Rua X"). */
function itinerario(d: DetalheViagem): string[] {
  const out: string[] = [];
  for (const p of d.stops) {
    const rua = limpa(p.name.replace(/,.*$/, '').replace(/\s+-\s+.*$/, '').replace(/\s+\d+[\w-]*$/, ''));
    if (rua && out[out.length - 1] !== rua) out.push(rua);
  }
  return out;
}

export function montarLinha(
  campus: Campus,
  rota: Rota,
  tab: Tabela,
  detalhes: Map<string, DetalheViagem>,
  hoje: string,
  urlOficial: string | undefined,
): { linha: Omit<Linha, 'hash' | 'alteradaEm'>; pontos: PontoCampus[] } | null {
  const pontos = new Map<string, PontoCampus>();
  const quadros: Quadro[] = [];
  const trajetos: Trajeto[] = [];
  let itin: string[] = [];

  for (const sentido of tab.directions) {
    const variantes = tab.trips.filter((v) => v.directionId === sentido.directionId);
    const porSeq = vigentes(sentido.services, hoje);
    for (const v of variantes) {
      const det = detalhes.get(v.tripId);
      if (!det) continue;
      const doCampus = det.stops.filter((p) => noCampus(campus, p.lat, p.lng));
      if (!doCampus.length) continue; // esta variante não passa no campus

      const origem = variantes.length > 1 ? `${limpa(sentido.desc)} (${limpa(v.headsign || v.tripDesc)})` : limpa(sentido.desc);
      const desenho = decodificar(det.shape);
      const distancias = distanciasEmOrdem(desenho, det.stops.map((p) => [p.lng, p.lat] as LonLat));
      trajetos.push({
        nome: limpa(v.headsign || v.tripDesc || det.tripName),
        origens: [origem],
        terminal: terminalDe(sentido.desc),
        comprimentoM: Math.round(comprimento(desenho)),
        coordenadas: simplificar(desenho, 8),
        pontos: det.stops
          .map((p, i) => ({ p, d: distancias[i] }))
          .filter(({ p }) => noCampus(campus, p.lat, p.lng))
          .map(({ p, d }) => ({ pontoId: p.stopId, distanciaM: Math.round(d ?? 0), segundos: p.int })),
      });
      for (const p of doCampus) pontos.set(p.stopId, { id: p.stopId, nome: limpa(p.name), lat: p.lat, lon: p.lng });
      if (!itin.length) itin = itinerario(det);

      for (const [tipoDia, servs] of porSeq) {
        // ordem publicada pela operadora (o Madrugadão atravessa a noite: 00:45 … 04:25); só reordena
        // quando junta mais de um serviço vigente do mesmo tipo de dia
        let saidas = servs
          .flatMap((s) => s.departures)
          .filter((d) => d.seq === v.seq)
          .map((d) => ({ hora: d.dep, acessivel: d.wa === 1, previsto: !!d.extra }));
        if (servs.length > 1) saidas = saidas.sort((a, b) => ordem(a.hora) - ordem(b.hora));
        if (saidas.length) quadros.push({ tipoDia, origem, terminal: terminalDe(sentido.desc), saidas });
      }
    }
  }
  if (!trajetos.length) return null;

  const codigo = limpa(rota.shortName || rota.longName);
  const primeira = limpa((rota.desc ?? '').split('\n')[0].replace(/^_+/, ''));
  return {
    linha: {
      codigo,
      nome: limpa(rota.longName),
      url: urlOficial ?? campus.fontePublica,
      caracteristica: primeira && primeira.length <= 80 ? primeira : null,
      quadros,
      itinerario: itin,
      trajetos,
    },
    pontos: [...pontos.values()],
  };
}

/** Minutos para ordenar horários; madrugada (< 03h) vai para o fim do dia de operação. */
function ordem(h: string): number {
  const [hh, mm] = h.split(':').map(Number);
  return hh * 60 + mm + (hh < 3 ? 1440 : 0);
}
