// Parsers das páginas públicas do Consórcio Fênix (consorciofenix.com.br/horarios).
// Qualquer coisa fora do esperado lança erro: preferimos falhar a gravar tabela errada.

import * as cheerio from 'cheerio';
import type { LonLat } from './geo';
import type { Quadro, Saida, TipoDia } from './types';

export const BASE = 'https://www.consorciofenix.com.br';

export interface ItemCatalogo {
  codigo: string;
  nome: string;
  url: string;
}

/** A página /horarios embute o catálogo inteiro num array JSON usado pela busca. */
export function parseCatalogo(html: string): ItemCatalogo[] {
  const m = html.match(/(\[\{"url":"\\\/horarios.*?\}\])/s);
  if (!m) throw new Error('Catálogo de linhas não encontrado em /horarios (layout mudou?)');
  const itens = JSON.parse(m[1]) as { url: string; name: string }[];
  return itens.map((x) => {
    const i = x.name.indexOf(' - ');
    if (i < 0) throw new Error(`Item de catálogo fora do padrão "CÓDIGO - Nome": ${x.name}`);
    return { codigo: x.name.slice(0, i).trim(), nome: x.name.slice(i + 3).trim(), url: BASE + x.url };
  });
}

const DIAS: Record<string, TipoDia> = {
  'dias uteis': 'util',
  sabado: 'sabado',
  sabados: 'sabado',
  'domingos e feriados': 'domingo',
  domingo: 'domingo',
  domingos: 'domingo',
};
const semAcento = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const limpa = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Terminais de integração: código curto e posição (para casar a aba de saída com o trajeto). */
export const TERMINAIS: Record<string, LonLat> = {
  TICEN: [-48.5537, -27.5984],
  TITRI: [-48.5226, -27.5847],
  TICAN: [-48.4557, -27.4515],
  TILAG: [-48.4706, -27.6032],
  TIRIO: [-48.5039, -27.6655],
  TISAN: [-48.5165, -27.5080],
};

export function terminalDe(origem: string): string | null {
  const t = semAcento(origem).toUpperCase();
  return Object.keys(TERMINAIS).find((k) => t.includes(k)) ?? null;
}

export interface PaginaLinha {
  codigo: string;
  nome: string;
  caracteristica: string | null;
  quadros: Quadro[];
  itinerario: string[];
  /** Caminho da página do mapa (iframe), ex.: /mapa/ticen-ufsc,188 */
  mapa: string | null;
}

export function parseLinha(html: string): PaginaLinha {
  const $ = cheerio.load(html);
  const codigo = limpa($('h3 strong').first().text());
  const nome = limpa($('h3 strong').first().nextAll('span').first().text());
  if (!codigo || !nome) throw new Error('Cabeçalho da linha (código/nome) não encontrado');

  let caracteristica: string | null = null;
  $('b').each((_, el) => {
    if (limpa($(el).text()).startsWith('Característica')) caracteristica = limpa($(el).next('span').text()) || null;
  });

  const quadros: Quadro[] = [];
  $('.my-tabs button[data-target]').each((_, tab) => {
    const rotulo = limpa($(tab).text());
    const tipoDia = DIAS[semAcento(rotulo).toLowerCase()];
    if (!tipoDia) throw new Error(`Aba de dia desconhecida: "${rotulo}"`);
    const conteudo = $($(tab).attr('data-target')!);
    conteudo.find('.my-subtabs button[data-target]').each((_, sub) => {
      const origem = limpa($(sub).text()).replace(/^Saída\s+/i, '');
      const saidas: Saida[] = [];
      $($(sub).attr('data-target')!)
        .find('[data-horario]')
        .each((_, h) => {
          const hora = $(h).attr('data-horario')!;
          if (!/^\d\d:\d\d$/.test(hora)) throw new Error(`Horário inválido "${hora}" em ${codigo}`);
          const marcas = $(h).find('b').text();
          saidas.push({ hora, acessivel: marcas.includes('E'), previsto: marcas.includes('*') });
        });
      quadros.push({ tipoDia, origem, terminal: terminalDe(origem), saidas });
    });
  });

  const itinerario = $('.content-text-itinerario li')
    .map((_, li) => limpa($(li).text()))
    .get()
    .filter(Boolean);
  // o mesmo itinerário aparece duas vezes (mobile/desktop) em algumas páginas
  const meio = itinerario.length / 2;
  const itin = Number.isInteger(meio) && itinerario.slice(0, meio).join('|') === itinerario.slice(meio).join('|')
    ? itinerario.slice(0, meio)
    : itinerario;

  const mapa = $('iframe[data-src^="/mapa/"]').first().attr('data-src') ?? null;
  return { codigo, nome, caracteristica, quadros, itinerario: itin, mapa };
}

export interface TrajetoKml {
  nome: string;
  coordenadas: LonLat[];
}

/** A página /mapa/... embute um KML numa string JS (`kmltext = "…"`); cada Placemark é um sentido. */
export function parseMapa(html: string): TrajetoKml[] {
  const m = html.match(/kmltext\s*=\s*("(?:[^"\\]|\\.)*")/s);
  if (!m) throw new Error('KML não encontrado na página do mapa');
  const kml: string = JSON.parse(m[1]);
  const $ = cheerio.load(kml, { xml: true });
  const out: TrajetoKml[] = [];
  $('Placemark').each((_, pm) => {
    const coordenadas: LonLat[] = [];
    $(pm)
      .find('LineString coordinates')
      .each((_, c) => {
        for (const tupla of $(c).text().trim().split(/\s+/)) {
          const [lon, lat] = tupla.split(',').map(Number);
          if (Number.isFinite(lon) && Number.isFinite(lat)) coordenadas.push([lon, lat]);
        }
      });
    if (coordenadas.length >= 2) out.push({ nome: limpa($(pm).children('name').text()), coordenadas });
  });
  return out;
}
