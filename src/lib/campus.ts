// O que é "linha do campus": o trajeto oficial passa a ≤ RAIO_M de algum ponto de ônibus do campus.
// A lista de ruas abaixo é só um filtro barato para decidir de quais linhas vale baixar o mapa.

import pontosJson from '../data/pontos-campus.json';
import { distLL, passagens, simplificar, comprimento, type LonLat } from './geo';
import { TERMINAIS, type TrajetoKml } from './fenix';
import type { PontoNoTrajeto, Quadro, Trajeto } from './types';

export const RAIO_M = 30;

export const PONTOS = pontosJson.pontos.map((p) => ({ id: p.id, nome: p.nome, lat: p.lat, lon: p.lon }));

/** Ruas do entorno do campus Trindade, sem acento e em caixa alta (o site tem erros de grafia: "CEASAR SEARA"). */
const RUAS_CAMPUS = [
  'DELFINO CONTI', 'LAURO LINHARES', 'EDU VIEIRA', 'SEARA', 'VITOR LIMA', 'SAMPAIO GONZAGA',
  'PAUSEWANG', 'JOAO PIO DUARTE', 'ANDREY CRISTIAN', 'ROMUALDO DE BARROS', 'SEABRA LEVIER', 'AURELIO HOMEM',
  'UFSC', 'UNIVERSITARIO', 'H.U.',
];
const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();

export function candidataPeloItinerario(nome: string, itinerario: string[]): boolean {
  const texto = norm([nome, ...itinerario].join(' | '));
  return RUAS_CAMPUS.some((r) => texto.includes(r));
}

function terminalDoInicio(c: LonLat[]): string | null {
  let melhor: string | null = null, menor = 800;   // até 800 m do terminal conhecido
  for (const [cod, pos] of Object.entries(TERMINAIS)) {
    const d = distLL(c[0], pos);
    if (d < menor) { menor = d; melhor = cod; }
  }
  return melhor;
}

const normNome = (s: string) => norm(s).replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Pontos do campus ao longo do trajeto, medidos a partir de `base` (m ao longo da linha).
 * Em trajeto circular (início ≈ fim) a contagem dá a volta: quem fica antes da base vem no fim.
 */
function pontosDesde(coords: LonLat[], base: number, total: number, circular: boolean): PontoNoTrajeto[] {
  const pontos: PontoNoTrajeto[] = [];
  for (const p of PONTOS) {
    const ds = passagens([p.lon, p.lat], coords, RAIO_M)
      .map((h) => h.aoLongo - base)
      .map((d) => (d < 0 && circular ? d + total : d))
      .filter((d) => d >= 0);
    if (ds.length) pontos.push({ pontoId: p.id, distanciaM: Math.round(Math.min(...ds)) });
  }
  return pontos.sort((a, b) => a.distanciaM - b.distanciaM);
}

/**
 * Converte os sentidos do KML em trajetos e diz de qual aba de saída ("origem") cada um parte.
 * Casamento, nesta ordem:
 *   1. trajeto que começa no terminal da origem (TICEN, TITRI…);
 *   2. circular que passa pelo terminal da origem → distâncias recontadas a partir do terminal;
 *   3. nome do trajeto começa com o nome da origem ("Serrinha - Monte Serrat - Ida");
 *   4. eliminação (sobrou uma origem e um trajeto) ou ordem de aparição;
 *   5. linha com um trajeto só: ele serve todas as origens.
 * Retorna null se nenhum sentido passa no campus.
 */
export function trajetosNoCampus(kml: TrajetoKml[], quadros: Quadro[] = []): Trajeto[] | null {
  const brutos = kml.map((t) => {
    const total = comprimento(t.coordenadas);
    const circular = distLL(t.coordenadas[0], t.coordenadas[t.coordenadas.length - 1]) < 300;
    return { t, total, circular, terminal: terminalDoInicio(t.coordenadas), base: 0, origens: [] as string[] };
  });

  const origens = [...new Map(quadros.map((q) => [q.origem, q.terminal])).entries()];
  const livre = (b: (typeof brutos)[number]) => b.origens.length === 0;
  const pendentes: string[] = [];
  for (const [origem, terminal] of origens) {
    let alvo = terminal ? brutos.find((b) => livre(b) && b.terminal === terminal) : undefined;
    if (!alvo && terminal) {
      // 2. circular que passa pelo terminal sem começar nele
      for (const b of brutos.filter((x) => livre(x) && x.circular)) {
        const h = passagens(TERMINAIS[terminal], b.t.coordenadas, 300);
        if (h.length) { alvo = b; b.base = h[0].aoLongo; break; }
      }
    }
    if (!alvo) {
      const o = normNome(origem.split(' - ')[0]);
      alvo = brutos.find((b) => livre(b) && normNome(b.t.nome).replace(/^N?\s*\d+\s*/, '').startsWith(o));
    }
    if (alvo) alvo.origens.push(origem);
    else pendentes.push(origem);
  }
  const sobrando = brutos.filter(livre);
  pendentes.forEach((o, i) => {
    if (sobrando[i]) sobrando[i].origens.push(o);
    else if (brutos.length === 1) brutos[0].origens.push(o);
  });

  let passaNoCampus = false;
  const trajetos = brutos.map((b) => {
    const pontos = pontosDesde(b.t.coordenadas, b.base, b.total, b.circular);
    if (pontos.length) passaNoCampus = true;
    return {
      nome: b.t.nome,
      origens: b.origens,
      terminal: b.terminal,
      comprimentoM: Math.round(b.total),
      coordenadas: simplificar(b.t.coordenadas, 5),
      pontos,
    } satisfies Trajeto;
  });
  return passaNoCampus ? trajetos : null;
}
