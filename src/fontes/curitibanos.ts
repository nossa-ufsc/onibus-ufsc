// Curitibanos: não há linha urbana com horário publicado. O que existe é o ônibus INSTITUCIONAL da UFSC
// (sede CBS-01 ↔ RU ↔ CEDUP ↔ NCS), divulgado em comunicado PDF da Seção de Transportes na página
// "Horários de ônibus" do site do campus. Este coletor:
//   1. lê a página pela API do WordPress e acha o PDF vigente (às vezes embrulhado no viewer do Google);
//   2. extrai o texto do PDF e lê as linhas "HH:MMH ORIGEM DESTINO" da tabela PERÍODO/SAÍDA/ORIGEM/DESTINO;
//   3. publica o que interessa ao mapa da sede: saídas do CBS-01 (para o RU) e chegadas ao CBS-01 (voltando).
// RU, CEDUP e NCS ficam fora do recorte do mapa da sede e não têm coordenada confiável — não viram ponto.
// Layout diferente no PDF = erro (a coleta falha e o app fica com o último dado bom).

import { extractText, getDocumentProxy } from 'unpdf';
import { fetchJson } from '../lib/http';
import type { Coleta, Coletor } from './tipos';
import type { Quadro, Trajeto } from '../lib/types';

const PAGINA = 'https://curitibanos.ufsc.br/?rest_route=/wp/v2/pages/20481';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
/** Ponto de embarque na sede (frente do bloco CBS-01). */
const CBS01 = { id: 'ufsc-cbs-01', nome: 'UFSC · CBS-01 (sede)', lat: -27.2849, lon: -50.5348 };
/** Intervalo entre trechos na tabela (cada perna do circuito leva ~10 min). */
const PERNA_S = 600;

export interface Perna { hora: string; origem: string; destino: string; periodo: string }

/** Lê as pernas do circuito no texto do comunicado. Exportado para os testes. */
export function lerComunicado(texto: string): { pernas: Perna[]; inicio: string | null } {
  if (!/PER[IÍ]ODO\s+SA[IÍ]DA\s+ORIGEM\s+DESTINO/i.test(texto)) throw new Error('tabela PERÍODO/SAÍDA/ORIGEM/DESTINO não encontrada no PDF');
  const pernas: Perna[] = [];
  let periodo = '';
  for (const linha of texto.split('\n')) {
    const m = linha.trim().match(/^(?:(ALMO[ÇC]O|JANTA|CAF[ÉE](?: DA MANH[ÃA])?)\s+)?(\d{1,2})[:h](\d{2})\s*H?\s+([A-Z0-9.\- ]+?)\s+([A-Z0-9.\-]+(?: [A-Z0-9.\-]+)?)\s*$/i);
    if (!m) continue;
    if (m[1]) periodo = m[1].toUpperCase();
    pernas.push({ hora: `${m[2].padStart(2, '0')}:${m[3]}`, origem: m[4].trim().toUpperCase(), destino: m[5].trim().toUpperCase(), periodo });
  }
  const ini = texto.match(/a partir de (\d{2})\/(\d{2})\/(\d{4})/i);
  return { pernas, inicio: ini ? `${ini[3]}-${ini[2]}-${ini[1]}` : null };
}

async function pdfVigente(): Promise<{ url: string; texto: string; modificada: string }> {
  const pag = await fetchJson<{ modified: string; content: { rendered: string } }>(PAGINA);
  const html = pag.content.rendered.replace(/&amp;/g, '&');
  const bruto = html.match(/(?:src|href)="([^"]+?\.pdf)/i)?.[1];
  if (!bruto) throw new Error('PDF do comunicado não encontrado na página "Horários de ônibus"');
  const url = decodeURIComponent(bruto.match(/[?&]url=(https?[^&]+)/)?.[1] ?? bruto);
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`PDF ${url} -> HTTP ${res.status}`);
  const pdf = await getDocumentProxy(new Uint8Array(await res.arrayBuffer()));
  const { text } = await extractText(pdf, { mergePages: true });
  return { url, texto: text, modificada: pag.modified };
}

export const coletarCuritibanos: Coletor = async (c) => {
  const { url, texto, modificada } = await pdfVigente();
  const { pernas, inicio } = lerComunicado(texto);
  console.log(`[${c.chave}] comunicado ${url.split('/').pop()} (página de ${modificada.slice(0, 10)}, vale desde ${inicio ?? '?'}): ${pernas.length} viagens`);
  if (pernas.length < 4) throw new Error(`só ${pernas.length} viagens lidas no comunicado`);
  const ehSede = (s: string) => /^CBS-?0?1$/.test(s.replace(/\s/g, ''));
  const ehRU = (s: string) => /^R\.?U\.?$/.test(s.replace(/\s/g, ''));

  const ida = pernas.filter((p) => ehSede(p.origem));
  const volta = pernas.filter((p) => ehSede(p.destino));
  if (!ida.length || !volta.length) throw new Error('comunicado sem viagens saindo/chegando no CBS-01 (mudou o circuito?)');

  const quadros: Quadro[] = [];
  const trajetos: Trajeto[] = [];
  const grupos = [
    ...[...new Set(ida.map((p) => p.destino))].map((d) => ({ origem: `CBS-01 → ${ehRU(d) ? 'RU' : d}`, saidas: ida.filter((p) => p.destino === d), chegaEm: 0 })),
    ...[...new Set(volta.map((p) => p.origem))].map((o) => ({ origem: `${ehRU(o) ? 'RU' : o} → CBS-01`, saidas: volta.filter((p) => p.origem === o), chegaEm: PERNA_S })),
  ];
  for (const g of grupos) {
    quadros.push({ tipoDia: 'util', origem: g.origem, terminal: null, saidas: g.saidas.map((p) => ({ hora: p.hora, acessivel: false, previsto: false })) });
    trajetos.push({
      nome: g.origem,
      origens: [g.origem],
      terminal: null,
      comprimentoM: 0,
      coordenadas: [], // sem desenho oficial do percurso
      pontos: [{ pontoId: CBS01.id, distanciaM: 0, segundos: g.chegaEm }],
    });
  }
  const out: Coleta = {
    pontos: [CBS01],
    linhas: [{
      codigo: 'UFSC',
      nome: 'Ônibus da UFSC (CBS-01 · RU · CEDUP · NCS)',
      url: 'https://curitibanos.ufsc.br/?page_id=20481',
      caracteristica: `Transporte institucional nos dias letivos, prioridade para isentos${inicio ? ` · vale desde ${inicio.split('-').reverse().join('/')}` : ''}`,
      quadros,
      itinerario: ['CBS-01', 'RU', 'CEDUP', 'NCS'],
      trajetos,
    }],
  };
  return out;
};
