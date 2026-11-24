// Araranguá: Viação Cidade (transporte municipal, tarifa zero), programação publicada pela Movitech —
// o link "Itinerário" do site viacidade.com.br leva para lá.
//
//   GET  <base>/view/schedules                      tabela pública: uma linha por viagem
//                                                   (id do trajeto, horário, itinerário, dias de operação)
//                                                   + token CSRF embutido na página e cookie _csrf
//   POST <base>/schedule/standard-route/<id>        trajeto: desenho (lat/lon TROCADOS), paradas com
//                                                   nome/ordem/coordenadas (sem id nem tempo)
//
// A tabela pública é a referência dos horários (o campo `schedules` do trajeto às vezes diverge dela).
// Sem tempo por parada na fonte: o app estima pela distância percorrida (`distanciaM`).

import { comprimento, distanciasEmOrdem, distLL, passagens, simplificar, type LonLat } from '../lib/geo';
import { mapLimitado } from '../lib/http';
import { itinerarioDeNomes, limpa, noCampus } from '../lib/comum';
import type { TipoDia, Trajeto } from '../lib/types';
import type { Coleta, Coletor, PontoCampus } from './tipos';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

interface Viagem { id: string; hora: string; prefixo: string; descricao: string; dias: TipoDia[] }
interface Trajetoria {
  id: number;
  itinerary_prefix: string;
  itinerary_description: string;
  route: { latitude: number; longitude: number }[];
  bus_stops: { description: string; street?: string; sequence: number; location: { latitude: number; longitude: number } }[];
  active: boolean;
}

const des = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

function diasDe(texto: string): TipoDia[] {
  const t = texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/segunda.*sabado/.test(t)) return ['util', 'sabado'];
  if (/segunda.*sexta/.test(t)) return ['util'];
  if (/^sabado/.test(t)) return ['sabado'];
  if (/domingo/.test(t)) return ['domingo'];
  if (/segunda|terca|quarta|quinta|sexta/.test(t)) return ['util'];
  throw new Error(`dias de operação desconhecidos: "${texto}"`);
}

/** Tabela pública + token/cookie para os POSTs. */
async function tabelaPublica(base: string) {
  const res = await fetch(`${base}/view/schedules`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`${base}/view/schedules -> HTTP ${res.status}`);
  const html = await res.text();
  const cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  const token = html.match(/const token = "([^"]+)"/)?.[1];
  if (!token || !cookie.includes('_csrf')) throw new Error('token CSRF da Movitech não encontrado (página mudou?)');
  return { viagens: lerTabela(html), token, cookie };
}

/** Lê a tabela pública (uma linha por viagem). Exportado para os testes. */
export function lerTabela(html: string): Viagem[] {
  const cab = [...html.matchAll(/<th[^>]*>(.*?)<\/th>/gs)].map((m) => des(m[1]));
  if (cab.join('|') !== 'ID|Horário|Itinerário|Trajeto Padrão|Dias de Operação|Locais Passados') {
    throw new Error(`colunas da tabela mudaram: ${cab.join(' | ')}`);
  }
  const viagens: Viagem[] = [];
  for (const tr of html.matchAll(/<tr[^>]*>(.*?)<\/tr>/gs)) {
    const td = [...tr[1].matchAll(/<td[^>]*>(.*?)<\/td>/gs)].map((m) => des(m[1]));
    if (td.length < 5 || !/^\d+$/.test(td[0])) continue;
    const [, prefixo = td[2], descricao = ''] = td[2].match(/^(\S+)\s+-\s+(.*)$/) ?? [];
    if (!/^\d\d:\d\d$/.test(td[1])) throw new Error(`horário inválido na tabela: "${td[1]}"`);
    viagens.push({ id: td[0], hora: td[1], prefixo, descricao: limpa(descricao), dias: diasDe(td[4]) });
  }
  if (viagens.length < 20) throw new Error(`tabela com só ${viagens.length} viagens`);
  return viagens;
}

/** Desenho em [lon, lat]. A fonte manda latitude/longitude TROCADAS (todas, em 2026-11); destroca pelo
 *  valor (em SC a longitude, ~-49, tem módulo maior que a latitude, ~-28), então funciona se corrigirem. */
export const desenhoDe = (t: Pick<Trajetoria, 'route'>): LonLat[] =>
  t.route.map((p) => (Math.abs(p.latitude) > Math.abs(p.longitude) ? [p.latitude, p.longitude] : [p.longitude, p.latitude]) as LonLat);

export const coletarMovitech: Coletor = async (c) => {
  if (c.fonte.tipo !== 'movitech') throw new Error('fonte errada');
  const base = c.fonte.base;
  const { viagens, token, cookie } = await tabelaPublica(base);
  const ids = [...new Set(viagens.map((v) => v.id))];
  const trajetorias = await mapLimitado(ids, 3, async (id) => {
    const res = await fetch(`${base}/schedule/standard-route/${id}`, {
      method: 'POST',
      headers: { 'User-Agent': UA, Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' },
      body: new URLSearchParams({ _csrf: token }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`trajeto ${id} -> HTTP ${res.status}`);
    const j = (await res.json()) as { data?: Trajetoria };
    if (!j.data || !Array.isArray(j.data.route)) throw new Error(`trajeto ${id} fora do formato`);
    return j.data;
  }, 200);
  console.log(`[${c.chave}] ${viagens.length} viagens, ${ids.length} trajetos`);


  // 1) pontos do campus: paradas cadastradas perto das âncoras (sem id na fonte → id pela coordenada)
  const idDe = (lat: number, lon: number) => `mv-${lat.toFixed(5)},${lon.toFixed(5)}`;
  const pontos = new Map<string, PontoCampus>();
  for (const t of trajetorias) {
    for (const s of t.bus_stops) {
      const { latitude: lat, longitude: lon } = s.location;
      if (!noCampus(c, lat, lon)) continue;
      // mesma parada cadastrada em vários trajetos com coordenadas levemente diferentes
      const igual = [...pontos.values()].find((p) => p.nome === limpa(s.description) && distLL([p.lon, p.lat], [lon, lat]) < 25);
      if (!igual) pontos.set(idDe(lat, lon), { id: idDe(lat, lon), nome: limpa(s.description), lat, lon });
    }
  }
  if (!pontos.size) throw new Error('nenhuma parada cadastrada perto do campus');
  const pontoMaisPerto = (lat: number, lon: number) =>
    [...pontos.values()].find((p) => distLL([p.lon, p.lat], [lon, lat]) < 25);

  // 2) cada trajeto que para (ou passa colado) num ponto do campus vira uma linha
  const out: Coleta = { linhas: [], pontos: [...pontos.values()] };
  for (const t of trajetorias) {
    if (!t.active) continue;
    const desenho = desenhoDe(t);
    if (desenho.length < 2) continue;
    const paradas = [...t.bus_stops].sort((a, b) => a.sequence - b.sequence);
    // paradas cadastradas no trajeto que são pontos do campus…
    const dist = distanciasEmOrdem(desenho, paradas.map((s) => [s.location.longitude, s.location.latitude] as LonLat));
    let noTrajeto: { pontoId: string; distanciaM: number }[] = paradas.flatMap((s, i) => {
      const p = pontoMaisPerto(s.location.latitude, s.location.longitude);
      return p && dist[i] != null ? [{ pontoId: p.id, distanciaM: Math.round(dist[i]!) }] : [];
    });
    // …mais os pontos do campus por onde o trajeto passa a ≤ 30 m: as listas de paradas da fonte são
    // incompletas (49C, 50C, 54C/D, 38L, 38B passam em frente sem a parada listada) e o ônibus municipal
    // para em qualquer ponto do percurso
    for (const p of pontos.values()) {
      if (noTrajeto.some((x) => x.pontoId === p.id)) continue;
      const h = passagens([p.lon, p.lat], desenho, 30)[0];
      if (h) noTrajeto.push({ pontoId: p.id, distanciaM: Math.round(h.aoLongo) });
    }
    noTrajeto.sort((a, b) => a.distanciaM - b.distanciaM);
    if (!noTrajeto.length) continue;

    const minhas = viagens.filter((v) => v.id === String(t.id));
    const prefixo = limpa(t.itinerary_prefix || minhas[0]?.prefixo || String(t.id));
    const descricao = limpa(t.itinerary_description || minhas[0]?.descricao || '');
    // de onde a linha parte, pelo nome do itinerário ("Sta Rosa De Lima/ Hospital/ T.centro" → "Sta Rosa De Lima")
    const origem = limpa(descricao.split('/')[0] || paradas[0]?.description || prefixo);
    const trajeto: Trajeto = {
      nome: descricao || prefixo,
      origens: [origem],
      terminal: null,
      comprimentoM: Math.round(comprimento(desenho)),
      coordenadas: simplificar(desenho, 8),
      pontos: noTrajeto,
    };
    const quadros = (['util', 'sabado', 'domingo'] as TipoDia[]).flatMap((tipoDia) => {
      const saidas = minhas.filter((v) => v.dias.includes(tipoDia)).map((v) => ({ hora: v.hora, acessivel: false, previsto: false }));
      return saidas.length ? [{ tipoDia, origem, terminal: null, saidas }] : [];
    });
    if (!quadros.length) continue; // trajeto sem viagem na tabela pública
    // dois trajetos com o mesmo prefixo (variante sem letra nova): mesma linha, outra origem
    const mesma = out.linhas.find((l) => l.codigo === prefixo);
    if (mesma) {
      if (mesma.trajetos.some((x) => x.origens[0] === origem)) {
        trajeto.origens = [`${origem} (${t.id})`];
        for (const q of quadros) q.origem = trajeto.origens[0];
      }
      mesma.trajetos.push(trajeto);
      mesma.quadros.push(...quadros);
      continue;
    }
    out.linhas.push({
      codigo: prefixo,
      nome: descricao || prefixo,
      url: c.fontePublica,
      caracteristica: null,
      quadros,
      itinerario: itinerarioDeNomes(paradas.map((s) => s.street || s.description)),
      trajetos: [trajeto],
    });
  }
  return out;
};
