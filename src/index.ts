// Coleta diária das linhas de ônibus que passam pelos campi (fonte: API aberta do Bus2/Mobilibus).
//
//   bun src/index.ts                  todos os campi: coleta, valida, grava data/<campus>.json e envia ao Convex
//   bun src/index.ts blumenau         só um campus
//   bun src/index.ts --skip-db        grava os snapshots, sem enviar
//   bun src/index.ts --dry-run        coleta e valida; não grava nem envia
//
// Cada campus é independente: se um falhar, os outros ainda são gravados e enviados; o processo
// termina com erro para o workflow avisar.

import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { CAMPI, type Campus } from './campi';
import { rotas, tabela, detalheViagem, type DetalheViagem } from './lib/bus2';
import { montarLinha, type PontoCampus } from './lib/montar';
import { mapLimitado, fetchHtml } from './lib/http';
import { BASE, parseCatalogo } from './lib/fenix';
import { diasEspeciais } from './lib/feriados';
import { enviarParaConvex } from './lib/convex';
import { mudancas, validarContraAnterior } from './lib/validate';
import type { DadosOnibus, Linha } from './lib/types';

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const SKIP_DB = DRY || args.includes('--skip-db');
const escolhidos = args.filter((a) => !a.startsWith('--'));

function hashDe(l: Omit<Linha, 'hash' | 'alteradaEm'>): string {
  const h = new Bun.CryptoHasher('sha1');
  h.update(JSON.stringify([l.nome, l.quadros, l.itinerario, l.trajetos.map((t) => [t.nome, t.comprimentoM, t.pontos])]));
  return h.digest('hex').slice(0, 16);
}

/** Florianópolis: link de cada linha para a página oficial do Fênix (o Bus2 não tem página pública por linha). */
async function urlsFenix(): Promise<Map<string, string>> {
  try {
    return new Map(parseCatalogo(await fetchHtml(`${BASE}/horarios`)).map((x) => [x.codigo, x.url]));
  } catch (e) {
    console.error(`⚠ catálogo do Fênix indisponível (${(e as Error).message}); links genéricos`);
    return new Map();
  }
}

async function coletar(c: Campus, agora: Date): Promise<{ dados: DadosOnibus; resumo: string } | null> {
  const arquivo = `data/${c.chave}.json`;
  const anterior: DadosOnibus | null = existsSync(arquivo) ? await Bun.file(arquivo).json() : null;
  const hoje = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(agora); // AAAA-MM-DD

  const rs = await rotas(c.projeto);
  const tabelas = await mapLimitado(rs, 6, (r) => tabela(r.routeId), 80);
  const viagens = [...new Set(tabelas.flatMap((t) => t?.trips.map((v) => v.tripId) ?? []))];
  console.log(`[${c.chave}] ${rs.length} linhas, ${viagens.length} viagens-modelo`);
  const detalhes = new Map<string, DetalheViagem>();
  await mapLimitado(viagens, 6, async (id) => detalhes.set(id, await detalheViagem(id)), 80);

  const urls = c.chave === 'florianopolis' ? await urlsFenix() : new Map<string, string>();
  const pontos = new Map<string, PontoCampus>();
  const linhas: Linha[] = [];
  rs.forEach((r, i) => {
    const t = tabelas[i];
    if (!t || (c.ignorar && c.ignorar.test(r.shortName ?? ''))) return;
    const m = montarLinha(c, r, t, detalhes, hoje, urls.get(r.shortName ?? ''));
    if (!m) return;
    for (const p of m.pontos) pontos.set(p.id, p);
    const hash = hashDe(m.linha);
    const antes = anterior?.linhas.find((l) => l.codigo === m.linha.codigo);
    linhas.push({ ...m.linha, hash, alteradaEm: antes && antes.hash === hash ? antes.alteradaEm : agora.toISOString() });
  });
  linhas.sort((a, b) => a.codigo.localeCompare(b.codigo, 'pt-BR', { numeric: true }));

  const ano = agora.getUTCFullYear();
  const dados: DadosOnibus = {
    versao: 1,
    campus: c.chave,
    fonte: c.fontePublica,
    coletadoEm: agora.toISOString(),
    diasEspeciais: diasEspeciais([ano, ano + 1]),
    pontos: [...pontos.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
    linhas,
  };

  const m = mudancas(dados, anterior);
  console.log(`[${c.chave}] ${linhas.length} linhas no campus (${dados.pontos.length} pontos): ${linhas.map((l) => l.codigo).join(', ')}`);
  console.log(`[${c.chave}] novas: ${m.novas.join(', ') || '—'} · extintas: ${m.extintas.join(', ') || '—'} · alteradas: ${m.alteradas.join(', ') || '—'}`);
  const erros = validarContraAnterior(dados, anterior);
  if (erros.length) {
    console.error(`✖ [${c.chave}] validação falhou (${erros.length}); nada gravado:\n- ${erros.join('\n- ')}`);
    return null;
  }
  const partes = [
    m.novas.length && `novas ${m.novas.length > 8 ? `${m.novas.length} linhas` : m.novas.join(', ')}`,
    m.extintas.length && `extintas ${m.extintas.join(', ')}`,
    m.alteradas.length && `alteradas ${m.alteradas.length > 8 ? `${m.alteradas.length} linhas` : m.alteradas.join(', ')}`,
  ].filter(Boolean);
  return { dados, resumo: partes.length ? `${c.chave}: ${partes.join(' · ')}` : '' };
}

async function main() {
  const agora = new Date();
  const campi = escolhidos.length ? CAMPI.filter((c) => escolhidos.includes(c.chave)) : CAMPI;
  if (!campi.length) throw new Error(`Campus desconhecido: ${escolhidos.join(', ')}`);
  let falhou = false;
  const resumos: string[] = [];

  for (const c of campi) {
    try {
      const r = await coletar(c, agora);
      if (!r) { falhou = true; continue; }
      if (r.resumo) resumos.push(r.resumo);
      if (DRY) continue;
      await mkdir('data', { recursive: true });
      await Bun.write(`data/${c.chave}.json`, JSON.stringify(r.dados, null, 1) + '\n');
      if (!SKIP_DB) {
        const s = await enviarParaConvex(r.dados);
        console.log(`[${c.chave}] ${s === 'enviado' ? 'enviado ao Convex' : 'CONVEX_SITE_URL/INGEST_API_KEY ausentes: envio pulado'}`);
      }
    } catch (e) {
      falhou = true;
      console.error(`✖ [${c.chave}] ${(e as Error).message}`);
    }
  }

  if (!DRY) await Bun.write('data/mudancas.txt', resumos.join(' | ') + '\n'); // usado na mensagem de commit
  if (process.env.GITHUB_STEP_SUMMARY) {
    await Bun.write(process.env.GITHUB_STEP_SUMMARY, `### Ônibus dos campi\n\n${resumos.map((r) => `- ${r}`).join('\n') || '- sem mudanças nas linhas'}\n`);
  }
  if (falhou) process.exit(1);
}

main().catch((e) => {
  console.error(`✖ ${(e as Error).message}`);
  process.exit(1);
});
