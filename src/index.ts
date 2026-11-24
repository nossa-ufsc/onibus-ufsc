// Coleta diária das linhas de ônibus que passam pelo campus Trindade.
//
//   bun src/index.ts             coleta, valida, grava data/linhas.json e envia ao Convex
//   bun src/index.ts --skip-db   coleta, valida e grava o snapshot, sem enviar
//   bun src/index.ts --dry-run   coleta e valida; não grava nem envia (imprime o resumo)
//
// Fluxo: catálogo (/horarios) → página de cada linha → filtro barato pelo itinerário →
// mapa oficial (KML) das candidatas → fica quem passa a ≤30 m de um ponto do campus.

import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { BASE, parseCatalogo, parseLinha, parseMapa } from './lib/fenix';
import { fetchHtml, mapLimitado } from './lib/http';
import { PONTOS, candidataPeloItinerario, trajetosNoCampus } from './lib/campus';
import { diasEspeciais } from './lib/feriados';
import { enviarParaConvex } from './lib/convex';
import { mudancas, validarContraAnterior } from './lib/validate';
import type { DadosOnibus, Linha } from './lib/types';

const args = new Set(process.argv.slice(2));
const DRY = args.has('--dry-run');
const SKIP_DB = DRY || args.has('--skip-db');
const SNAPSHOT = 'data/linhas.json';

function hashDe(l: Omit<Linha, 'hash' | 'alteradaEm'>): string {
  const h = new Bun.CryptoHasher('sha1');
  h.update(JSON.stringify([l.nome, l.quadros, l.itinerario, l.trajetos.map((t) => [t.nome, t.comprimentoM, t.pontos])]));
  return h.digest('hex').slice(0, 16);
}

async function main() {
  const agora = new Date();
  const anterior: DadosOnibus | null = existsSync(SNAPSHOT) ? await Bun.file(SNAPSHOT).json() : null;
  const conhecidas = new Set(anterior?.linhas.map((l) => l.codigo) ?? []);

  const catalogo = parseCatalogo(await fetchHtml(`${BASE}/horarios`));
  if (catalogo.length < 50) throw new Error(`Catálogo com só ${catalogo.length} linhas (esperado ~200)`);
  console.log(`Catálogo: ${catalogo.length} linhas`);

  // 1) página de cada linha (horários + itinerário). Página que falha não derruba a coleta,
  //    a não ser que seja uma linha que já passava no campus.
  const paginas = await mapLimitado(catalogo, 4, async (item) => {
    try {
      return { item, pagina: parseLinha(await fetchHtml(item.url)) };
    } catch (e) {
      if (conhecidas.has(item.codigo)) throw new Error(`Linha do campus ${item.codigo} falhou: ${(e as Error).message}`);
      console.error(`⚠ ${item.codigo} ignorada: ${(e as Error).message}`);
      return null;
    }
  });

  // 2) só baixa o mapa de quem pode passar no campus (itinerário cita rua do entorno, ou já passava)
  const candidatas = paginas.filter(
    (p): p is NonNullable<typeof p> =>
      !!p && !!p.pagina.mapa && (conhecidas.has(p.item.codigo) || candidataPeloItinerario(p.item.nome, p.pagina.itinerario)),
  );
  console.log(`Candidatas pelo itinerário: ${candidatas.length}`);

  const linhas: Linha[] = [];
  await mapLimitado(candidatas, 3, async ({ item, pagina }) => {
    const trajetos = trajetosNoCampus(parseMapa(await fetchHtml(BASE + pagina.mapa)), pagina.quadros);
    if (!trajetos) return;
    const base = {
      codigo: item.codigo,
      nome: pagina.nome || item.nome,
      url: item.url,
      caracteristica: pagina.caracteristica,
      quadros: pagina.quadros,
      itinerario: pagina.itinerario,
      trajetos,
    };
    const hash = hashDe(base);
    const antes = anterior?.linhas.find((l) => l.codigo === item.codigo);
    linhas.push({ ...base, hash, alteradaEm: antes && antes.hash === hash ? antes.alteradaEm : agora.toISOString() });
  });
  linhas.sort((a, b) => a.codigo.localeCompare(b.codigo, 'pt-BR', { numeric: true }));

  const ano = agora.getUTCFullYear();
  const dados: DadosOnibus = {
    versao: 1,
    fonte: `${BASE}/horarios`,
    coletadoEm: agora.toISOString(),
    diasEspeciais: diasEspeciais([ano, ano + 1]),
    pontos: PONTOS,
    linhas,
  };

  const erros = validarContraAnterior(dados, anterior);
  const m = mudancas(dados, anterior);
  const resumo = [
    `Linhas no campus: ${linhas.map((l) => l.codigo).join(', ')}`,
    `Novas: ${m.novas.join(', ') || '—'} · Extintas: ${m.extintas.join(', ') || '—'} · Alteradas: ${m.alteradas.join(', ') || '—'}`,
  ];
  console.log(resumo.join('\n'));
  if (process.env.GITHUB_STEP_SUMMARY) {
    await Bun.write(process.env.GITHUB_STEP_SUMMARY, `### Ônibus do campus\n\n${resumo.map((r) => `- ${r}`).join('\n')}\n`);
  }
  if (erros.length) {
    console.error(`\n✖ Validação falhou (${erros.length}); nada foi gravado:\n- ${erros.join('\n- ')}`);
    process.exit(1);
  }

  if (DRY) {
    console.log('\n--dry-run: nada gravado.');
    return;
  }
  await mkdir('data', { recursive: true });
  await Bun.write(SNAPSHOT, JSON.stringify(dados, null, 1) + '\n');
  // usado pela mensagem de commit do workflow; vazio = nada mudou nas linhas
  const partes = [
    m.novas.length && `novas: ${m.novas.join(', ')}`,
    m.extintas.length && `extintas: ${m.extintas.join(', ')}`,
    m.alteradas.length && `alteradas: ${m.alteradas.join(', ')}`,
  ].filter(Boolean);
  await Bun.write('data/mudancas.txt', partes.join(' · ') + '\n');
  console.log(`Snapshot gravado em ${SNAPSHOT}`);

  if (!SKIP_DB) {
    const r = await enviarParaConvex(dados);
    console.log(r === 'enviado' ? 'Enviado ao Convex.' : '⚠ CONVEX_SITE_URL/INGEST_API_KEY ausentes: envio pulado.');
  }
}

main().catch((e) => {
  console.error(`✖ ${(e as Error).message}`);
  process.exit(1);
});
