// Fixtures = páginas reais do site do Fênix salvas em 23/11/2026. Se o layout mudar, estes testes
// (e a validação da coleta) quebram antes de qualquer dado ruim chegar ao app.

import { describe, expect, test } from 'bun:test';
import { parseCatalogo, parseLinha, parseMapa } from '../src/lib/fenix';
import { trajetosNoCampus, candidataPeloItinerario } from '../src/lib/campus';
import { validarLinha } from '../src/lib/validate';
import { diasEspeciais } from '../src/lib/feriados';

const fixture = (n: string) => Bun.file(`${import.meta.dir}/fixtures/${n}`).text();

describe('catálogo', () => {
  test('lê todas as linhas com código, nome e URL', async () => {
    const c = parseCatalogo(await fixture('catalogo.html'));
    expect(c.length).toBeGreaterThan(150);
    const l137 = c.find((x) => x.codigo === '137')!;
    expect(l137.nome).toBe('Volta ao Morro Norte via H.U.');
    expect(l137.url).toBe('https://www.consorciofenix.com.br/horarios/volta-ao-morro-norte-via-hu,137');
    expect(c.some((x) => x.codigo === '163')).toBe(false); // extinta (o OSM ainda tinha)
  });
});

describe('página da linha', () => {
  test('137: um quadro de dias úteis saindo do TICEN, com elevador', async () => {
    const p = parseLinha(await fixture('linha-137.html'));
    expect(p.codigo).toBe('137');
    expect(p.caracteristica).toBe('Alimentadora TICEN');
    expect(p.quadros).toHaveLength(1);
    const q = p.quadros[0];
    expect(q).toMatchObject({ tipoDia: 'util', terminal: 'TICEN' });
    expect(q.saidas[0]).toEqual({ hora: '05:15', acessivel: true, previsto: false });
    expect(q.saidas.at(-1)!.hora).toBe('00:05');
    expect(p.itinerario[0]).toBe('TICEN - TERMINAL DE INTEGRAÇÃO DO CENTRO');
    expect(p.itinerario).toContain('RUA DELFINO CONTI');
    expect(p.mapa).toBe('/mapa/volta-ao-morro-norte-via-hu,137');
  });

  test('233: três tipos de dia × duas saídas, com horários previstos (*)', async () => {
    const p = parseLinha(await fixture('linha-233.html'));
    expect(new Set(p.quadros.map((q) => q.tipoDia))).toEqual(new Set(['util', 'sabado', 'domingo']));
    expect(new Set(p.quadros.map((q) => q.terminal))).toEqual(new Set(['TICAN', 'TITRI']));
    expect(p.quadros.some((q) => q.saidas.some((s) => s.previsto))).toBe(true);
    expect(candidataPeloItinerario('TICAN / UFSC via Santa Mônica', p.itinerario)).toBe(true);
  });
});

describe('mapa oficial', () => {
  test('233: dois sentidos; só a volta (saindo do TITRI) entra no campus', async () => {
    const kml = parseMapa(await fixture('mapa-233.html'));
    expect(kml.map((t) => t.nome)).toEqual(['233 Ida T.TIC - T.TIR', '233 Volta T.TIR - T.TIC']);
    const p = parseLinha(await fixture('linha-233.html'));
    const [ida, volta] = trajetosNoCampus(kml, p.quadros)!;
    expect([ida.terminal, volta.terminal]).toEqual(['TICAN', 'TITRI']);
    expect([ida.origens, volta.origens]).toEqual([['TICAN - Box 6'], ['TITRI - Box 4']]);
    expect(ida.pontos).toHaveLength(0);
    expect(volta.pontos.length).toBeGreaterThan(0);
    // pontos em ordem de percurso
    const d = volta.pontos.map((p) => p.distanciaM);
    expect(d).toEqual([...d].sort((a, b) => a - b));
  });

  test('137 (circular, sai e volta ao TICEN) passa no campus e mantém o desenho', async () => {
    const p = parseLinha(await fixture('linha-137.html'));
    const [t] = trajetosNoCampus(parseMapa(await fixture('mapa-137.html')), p.quadros)!;
    expect(t.terminal).toBe('TICEN');
    expect(t.origens).toEqual(['TICEN - Plataforma A - Box 6']);
    expect(t.coordenadas.length).toBeGreaterThan(50);
    expect(t.pontos.length).toBeGreaterThan(5);
    // ~10 km do TICEN até o campus pela Beira-Mar
    expect(t.pontos[0].distanciaM).toBeGreaterThan(6_000);
    expect(t.pontos[0].distanciaM).toBeLessThan(13_000);
  });
});

describe('validação', () => {
  test('aceita a virada da meia-noite e recusa horário fora de ordem', async () => {
    const p = parseLinha(await fixture('linha-137.html'));
    const trajetos = trajetosNoCampus(parseMapa(await fixture('mapa-137.html')), p.quadros)!;
    const linha = { codigo: '137', nome: p.nome, url: '', caracteristica: null, quadros: p.quadros, itinerario: p.itinerario, trajetos, hash: '', alteradaEm: '' };
    expect(validarLinha(linha)).toEqual([]);
    const ruim = structuredClone(linha);
    ruim.quadros[0].saidas.splice(3, 0, { hora: '04:00', acessivel: false, previsto: false });
    expect(validarLinha(ruim).join()).toContain('fora de ordem');
  });
});

describe('dias especiais', () => {
  test('feriados móveis de 2027 e véspera de Natal', () => {
    const d = diasEspeciais([2027]);
    expect(d['2027-03-26']).toBe('domingo'); // Sexta-feira Santa (Páscoa 28/03/2027)
    expect(d['2027-02-08']).toBe('sabado');  // segunda de Carnaval
    expect(d['2027-05-27']).toBe('domingo'); // Corpus Christi
    expect(d['2027-12-24']).toBe('sabado');
  });
});
