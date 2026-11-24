// Fixtures = respostas reais da API do Bus2 (24/11/2026) e a página /horarios do Fênix (23/11/2026).
// Se o formato mudar, estes testes (e a validação da coleta) quebram antes de dado ruim chegar ao app.

import { describe, expect, test } from 'bun:test';
import { decodificar, type DetalheViagem, type Rota, type Tabela } from '../src/lib/bus2';
import { montarLinha } from '../src/lib/montar';
import { paraApp } from '../src/lib/convex';
import { parseCatalogo } from '../src/lib/fenix';
import { validarLinha } from '../src/lib/validate';
import { diasEspeciais } from '../src/lib/feriados';
import { distLL } from '../src/lib/geo';
import { CAMPI } from '../src/campi';
import type { DadosOnibus, Linha } from '../src/lib/types';

const HOJE = '2026-11-24';
const [FLORIPA, BLUMENAU] = CAMPI;

async function fixture(nome: string) {
  const f = (await Bun.file(`${import.meta.dir}/fixtures/bus2/${nome}.json`).json()) as {
    rota: Rota; tabela: Tabela; detalhes: Record<string, DetalheViagem>;
  };
  return { ...f, detalhes: new Map(Object.entries(f.detalhes)) };
}
const comoLinha = (l: Omit<Linha, 'hash' | 'alteradaEm'>): Linha => ({ ...l, hash: 'x', alteradaEm: HOJE });

describe('Florianópolis · 188 TICEN/UFSC', () => {
  test('um quadro de dias úteis, ligado ao trajeto, com o tempo oficial até cada ponto do campus', async () => {
    const f = await fixture('fl-188');
    const m = montarLinha(FLORIPA, f.rota, f.tabela, f.detalhes, HOJE, 'https://x/188')!;
    expect(m).not.toBeNull();
    const { linha, pontos } = m;
    expect(linha.codigo).toBe('188');
    expect(linha.url).toBe('https://x/188');
    expect(linha.quadros.map((q) => [q.tipoDia, q.origem])).toEqual([['util', 'TICEN - Plataforma A - Box 14']]);
    expect(linha.quadros[0].saidas.length).toBeGreaterThan(80);
    expect(linha.quadros[0].saidas[0]).toMatchObject({ hora: '06:00', acessivel: true });

    const [t] = linha.trajetos;
    expect(t.origens).toEqual(['TICEN - Plataforma A - Box 14']);
    expect(t.terminal).toBe('TICEN');
    expect(t.pontos.length).toBeGreaterThan(3);
    // em ordem de percurso, nos dois relógios
    const seg = t.pontos.map((p) => p.segundos!);
    const dist = t.pontos.map((p) => p.distanciaM);
    expect(seg).toEqual([...seg].sort((a, b) => a - b));
    expect(dist).toEqual([...dist].sort((a, b) => a - b));
    // TICEN → campus: ~6 km e ~15 min
    expect(dist[0]).toBeGreaterThan(4_000);
    expect(seg[0]).toBeGreaterThan(600);
    // todo ponto do trajeto está na lista de pontos do campus
    const ids = new Set(pontos.map((p) => p.id));
    expect(t.pontos.every((p) => ids.has(p.pontoId))).toBe(true);
    expect(validarLinha(comoLinha(linha))).toEqual([]);
  });

  test('o primeiro ponto do 188 fica perto do desenho decodificado', async () => {
    const f = await fixture('fl-188');
    const det = [...f.detalhes.values()][0];
    const desenho = decodificar(det.shape);
    expect(distLL(desenho[0], [det.stops[0].lng, det.stops[0].lat])).toBeLessThan(150);
  });
});

describe('Blumenau · 153 Salto do Norte (circular com várias variantes)', () => {
  test('cada variante vira uma origem própria e todo quadro tem trajeto', async () => {
    const f = await fixture('bl-153');
    const { linha } = montarLinha(BLUMENAU, f.rota, f.tabela, f.detalhes, HOJE, undefined)!;
    const origens = linha.trajetos.flatMap((t) => t.origens);
    expect(new Set(origens).size).toBe(origens.length);
    for (const q of linha.quadros) expect(origens).toContain(q.origem);
    expect(linha.url).toBe(BLUMENAU.fontePublica);
    expect(validarLinha(comoLinha(linha))).toEqual([]);
  });

  test('envio ao app: só os trechos perto do campus, quebrados por um ponto de fora', async () => {
    const f = await fixture('bl-153');
    const m = montarLinha(BLUMENAU, f.rota, f.tabela, f.detalhes, HOJE, undefined)!;
    const dados: DadosOnibus = {
      versao: 1, campus: 'blumenau', fonte: '', coletadoEm: '', diasEspeciais: {},
      pontos: m.pontos, linhas: [comoLinha(m.linha)],
    };
    const app = paraApp(dados);
    const antes = dados.linhas[0].trajetos.reduce((s, t) => s + t.coordenadas.length, 0);
    const depois = app.linhas[0].trajetos.reduce((s, t) => s + t.coordenadas.length, 0);
    expect(depois).toBeLessThan(antes * 0.6);
    // circular sai e volta ao Terminal Aterro: precisa de pelo menos um ponto "de fora" separando os trechos
    const n = m.pontos.length;
    const centro: [number, number] = [m.pontos.reduce((s, p) => s + p.lon, 0) / n, m.pontos.reduce((s, p) => s + p.lat, 0) / n];
    const t = app.linhas[0].trajetos[0];
    expect(t.coordenadas.some((c) => distLL(c as [number, number], centro) > 1_800)).toBe(true);
  });
});

describe('validação', () => {
  const linha = (horas: string[]): Linha => comoLinha({
    codigo: 'X', nome: 'X', url: '', caracteristica: null, itinerario: [],
    quadros: [{ tipoDia: 'util', origem: 'A', terminal: null, saidas: horas.map((hora) => ({ hora, acessivel: false, previsto: false })) }],
    trajetos: [{ nome: 'A', origens: ['A'], terminal: null, comprimentoM: 1, coordenadas: Array.from({ length: 12 }, (_, i) => [-48.5 + i / 1e3, -27.6]), pontos: [] }],
  });
  test('aceita uma virada de dia (23:15 → 00:05, Madrugadão 04:25 → 00:45)', () => {
    expect(validarLinha(linha(['22:00', '23:15', '00:05']))).toEqual([]);
    expect(validarLinha(linha(['03:37', '04:25', '00:45', '01:45']))).toEqual([]);
  });
  test('recusa horário fora de ordem e saída sem trajeto', () => {
    expect(validarLinha(linha(['08:00', '07:00', '09:00', '06:00'])).join()).toContain('fora de ordem');
    const l = linha(['08:00']);
    l.quadros[0].origem = 'B';
    expect(validarLinha(l).join()).toContain('sem trajeto');
  });
});

describe('fontes auxiliares', () => {
  test('catálogo do Fênix dá o link oficial de cada linha', async () => {
    const c = parseCatalogo(await Bun.file(`${import.meta.dir}/fixtures/catalogo.html`).text());
    expect(c.find((x) => x.codigo === '188')?.url).toBe('https://www.consorciofenix.com.br/horarios/ticen-ufsc,188');
  });
  test('feriados móveis de 2027 e véspera de Natal', () => {
    const d = diasEspeciais([2027]);
    expect(d['2027-03-26']).toBe('domingo'); // Sexta-feira Santa
    expect(d['2027-02-08']).toBe('sabado');  // segunda de Carnaval
    expect(d['2027-05-27']).toBe('domingo'); // Corpus Christi
    expect(d['2027-12-24']).toBe('sabado');
  });
});
