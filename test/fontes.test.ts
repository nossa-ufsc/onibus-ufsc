// Coletores de Joinville, Araranguá e Curitibanos contra respostas reais salvas em 24/11/2026.

import { afterEach, describe, expect, test } from 'bun:test';
import { CAMPI } from '../src/campi';
import { coletarOnibusInfo } from '../src/fontes/onibusinfo';
import { desenhoDe, lerTabela } from '../src/fontes/movitech';
import { lerComunicado } from '../src/fontes/curitibanos';
import { validarLinha } from '../src/lib/validate';
import { diasEspeciais } from '../src/lib/feriados';
import type { Linha } from '../src/lib/types';

const fx = (p: string) => Bun.file(`${import.meta.dir}/fixtures/${p}`);
const campus = (k: string) => CAMPI.find((c) => c.chave === k)!;
const original = globalThis.fetch;
afterEach(() => (globalThis.fetch = original));

describe('Joinville · onibus.info', () => {
  test('linhas que entram no Perini, com tempo oficial e só as paradas que a viagem atende', async () => {
    const api = (await fx('joinville/api.json').json()) as Record<string, unknown>;
    globalThis.fetch = (async (url: string) => {
      const k = String(url).replace('https://onibus.info/api/', '');
      if (!(k in api)) throw new Error(`sem fixture para ${k}`);
      return new Response(JSON.stringify(api[k]));
    }) as unknown as typeof fetch;

    const { linhas, pontos } = await coletarOnibusInfo(campus('joinville'), '2026-11-24');
    expect(linhas.map((l) => l.codigo).sort()).toEqual(['0426', '0429']);
    expect(pontos.map((p) => p.nome)).toContain('UFSC Perini');

    const l426 = linhas.find((l) => l.codigo === '0426')!;
    expect(l426.url).toBe('https://onibus.info/linhas/0426');
    expect(l426.quadros.map((q) => [q.tipoDia, q.origem])).toEqual([
      ['util', 'Terminal Norte - Plataforma 2, Box 13'],
      ['util', 'Allflex Perini'],
    ]);
    const ida = l426.trajetos.find((t) => t.origens[0].startsWith('Terminal Norte'))!;
    // Terminal Norte → Perini: ~6,5 km e ~24 min, pela programação
    expect(ida.pontos[0].distanciaM).toBeGreaterThan(5_000);
    expect(ida.pontos[0].segundos!).toBeGreaterThan(1_000);
    expect(ida.coordenadas.length).toBeGreaterThan(20);

    // 0429 sai da "UFSC Perini": não pode listar as paradas anteriores do desenho (Allflex, Tplink)
    const [t429] = linhas.find((l) => l.codigo === '0429')!.trajetos;
    expect(t429.pontos[0]).toMatchObject({ pontoId: '2381', distanciaM: 0, segundos: 0 });
    expect(t429.pontos.map((p) => p.pontoId)).not.toContain('2835');

    for (const l of linhas) expect(validarLinha({ ...l, hash: 'x', alteradaEm: '' } as Linha)).toEqual([]);
  });
});

describe('Araranguá · Movitech', () => {
  test('lê a tabela pública: 99 viagens e os dias de operação', async () => {
    const v = lerTabela(await fx('ararangua/tabela.html').text());
    expect(v).toHaveLength(99);
    expect(v.find((x) => x.prefixo === '48B')).toMatchObject({ hora: '07:00', descricao: 'Sta Rosa De Lima/ Hospital/ T.centro', dias: ['util'] });
    expect(v.filter((x) => x.dias.includes('sabado')).length).toBe(8); // 6 de sábado + 2 de segunda a sábado
  });

  test('destroca latitude/longitude do desenho', async () => {
    const { data } = await fx('ararangua/trajeto-48b.json').json();
    const [lon, lat] = desenhoDe(data)[0];
    expect(lon).toBeLessThan(-49);
    expect(lat).toBeGreaterThan(-29.1);
    expect(lat).toBeLessThan(-28.8);
  });
});

describe('Curitibanos · comunicado da UFSC', () => {
  test('lê as 23 viagens do circuito e a data de início', async () => {
    const { pernas, inicio } = lerComunicado(await fx('curitibanos/comunicado-06-2026.txt').text());
    expect(inicio).toBe('2026-08-10');
    expect(pernas).toHaveLength(23);
    expect(pernas[0]).toEqual({ hora: '11:15', origem: 'CBS-01', destino: 'RU', periodo: 'ALMOÇO' });
    expect(pernas.filter((p) => p.origem === 'CBS-01').map((p) => p.hora)).toEqual(['11:15', '11:55', '12:55', '18:00', '19:00']);
    expect(pernas.at(-1)).toEqual({ hora: '19:40', origem: 'RU', destino: 'CBS-01', periodo: 'JANTA' });
  });

  test('PDF de outro formato falha em vez de gravar vazio', () => {
    expect(() => lerComunicado('Comunicado sobre outra coisa')).toThrow();
  });
});

describe('feriados municipais', () => {
  test('cada campus com o seu', () => {
    expect(diasEspeciais([2027], campus('joinville').feriadosMunicipais)['2027-03-09']).toBe('domingo');
    expect(diasEspeciais([2027], campus('joinville').feriadosMunicipais)['2027-03-23']).toBeUndefined();
    expect(diasEspeciais([2027], campus('florianopolis').feriadosMunicipais)['2027-03-23']).toBe('domingo');
    expect(diasEspeciais([2027], campus('blumenau').feriadosMunicipais)['2027-09-02']).toBe('domingo');
  });
});
