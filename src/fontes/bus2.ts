// Florianópolis e Blumenau: API aberta do Bus2/Mobilibus (ver src/lib/bus2.ts e src/lib/montar.ts).

import { rotas, tabela, detalheViagem, type DetalheViagem } from '../lib/bus2';
import { montarLinha } from '../lib/montar';
import { fetchHtml, mapLimitado } from '../lib/http';
import { BASE, parseCatalogo } from '../lib/fenix';
import type { Coleta, Coletor, PontoCampus } from './tipos';

/** Florianópolis: link de cada linha para a página oficial do Fênix (o Bus2 não tem página pública por linha). */
async function urlsFenix(): Promise<Map<string, string>> {
  try {
    return new Map(parseCatalogo(await fetchHtml(`${BASE}/horarios`)).map((x) => [x.codigo, x.url]));
  } catch (e) {
    console.error(`⚠ catálogo do Fênix indisponível (${(e as Error).message}); links genéricos`);
    return new Map();
  }
}

export const coletarBus2: Coletor = async (c, hoje) => {
  if (c.fonte.tipo !== 'bus2') throw new Error('fonte errada');
  const { projeto, ignorar } = c.fonte;
  const rs = await rotas(projeto);
  const tabelas = await mapLimitado(rs, 6, (r) => tabela(r.routeId), 80);
  const viagens = [...new Set(tabelas.flatMap((t) => t?.trips.map((v) => v.tripId) ?? []))];
  console.log(`[${c.chave}] ${rs.length} linhas, ${viagens.length} viagens-modelo`);
  const detalhes = new Map<string, DetalheViagem>();
  await mapLimitado(viagens, 6, async (id) => detalhes.set(id, await detalheViagem(id)), 80);

  const urls = c.chave === 'florianopolis' ? await urlsFenix() : new Map<string, string>();
  const pontos = new Map<string, PontoCampus>();
  const out: Coleta = { linhas: [], pontos: [] };
  rs.forEach((r, i) => {
    const t = tabelas[i];
    if (!t || (ignorar && ignorar.test(r.shortName ?? ''))) return;
    const m = montarLinha(c, r, t, detalhes, hoje, urls.get(r.shortName ?? ''));
    if (!m) return;
    for (const p of m.pontos) pontos.set(p.id, p);
    out.linhas.push(m.linha);
  });
  out.pontos = [...pontos.values()];
  return out;
};
