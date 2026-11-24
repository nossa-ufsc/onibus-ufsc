// Campi atendidos e de onde vêm os dados de cada um. Toda fonte é a programação oficial publicada pela
// operadora (ou pela UFSC); cada tipo de fonte tem um coletor em src/fontes/.
//
// Um ponto de ônibus é "do campus" se fica a até `raioM` de alguma âncora; a linha entra se alguma
// viagem dela para num ponto do campus.

export type ChaveCampus = 'florianopolis' | 'blumenau' | 'joinville' | 'ararangua' | 'curitibanos';

export type Fonte =
  /** API aberta do Bus2/Mobilibus (Floripa no Ponto, BluMob). `projeto` = hash da cidade em
   *  https://cdn.bus2.studio/api/projects → project-details?v=2&project_id=<id>. */
  | { tipo: 'bus2'; projeto: string; ignorar?: RegExp }
  /** onibus.info — horários, trajetos e tempo real do transporte de Joinville (Gidion/Transtusa). */
  | { tipo: 'onibusinfo' }
  /** Viação Cidade (Araranguá, tarifa zero) — programação publicada pela Movitech. */
  | { tipo: 'movitech'; base: string }
  /** Ônibus interno da UFSC Curitibanos — comunicado em PDF no site do campus. */
  | { tipo: 'ufsc-curitibanos' };

export interface Ancora { nome: string; lat: number; lon: number; raioM: number }

export interface Campus {
  /** Mesmo enum `campus` do app (convex/validators.ts). */
  chave: ChaveCampus;
  nome: string;
  fonte: Fonte;
  /** Página pública da tabela, para a pessoa conferir. */
  fontePublica: string;
  ancoras: Ancora[];
  /** Feriados municipais (MM-DD), que operam como domingo. */
  feriadosMunicipais: string[];
}

export const CAMPI: Campus[] = [
  {
    chave: 'florianopolis',
    nome: 'Florianópolis · Trindade',
    fonte: { tipo: 'bus2', projeto: '4pbxo' },
    fontePublica: 'https://www.consorciofenix.com.br/horarios',
    ancoras: [
      { nome: 'Campus Trindade', lat: -27.6005, lon: -48.5195, raioM: 750 },
      // ponta oeste (CFH/Serrinha: Rua Douglas Seabra Levier e Marcus Aurélio Homem)
      { nome: 'Campus Trindade · oeste', lat: -27.5968, lon: -48.5258, raioM: 300 },
    ],
    feriadosMunicipais: ['03-23'], // aniversário de Florianópolis
  },
  {
    chave: 'blumenau',
    nome: 'Blumenau',
    // 13xx = "Linha Trabalhador": fretamento para empresas, não é linha que o aluno pega
    fonte: { tipo: 'bus2', projeto: '5f1lx', ignorar: /^13\d\d$/ },
    fontePublica: 'https://bus2.info/reports/2you/5f1lx',
    ancoras: [
      // sede Salto do Norte (Rua Marechal Rondon, 880) — em frente ao Terminal do Aterro
      { nome: 'Sede Salto do Norte', lat: -26.8725, lon: -49.0947, raioM: 350 },
      // sede Velha (Rua João Pessoa, 2750) — laboratórios
      { nome: 'Sede Velha', lat: -26.9207, lon: -49.0988, raioM: 250 },
    ],
    feriadosMunicipais: ['09-02'], // fundação de Blumenau
  },
  {
    chave: 'joinville',
    nome: 'Joinville · Perini',
    fonte: { tipo: 'onibusinfo' },
    fontePublica: 'https://onibus.info',
    // sede no Perini Business Park: as linhas entram no condomínio (pontos "UFSC Perini", "Perini 10"…)
    ancoras: [{ nome: 'UFSC Joinville (Perini)', lat: -26.2353, lon: -48.885, raioM: 450 }],
    feriadosMunicipais: ['03-09'], // fundação de Joinville
  },
  {
    chave: 'ararangua',
    nome: 'Araranguá',
    fonte: { tipo: 'movitech', base: 'https://avi-cidade-prog-api.movitech.com.br' },
    fontePublica: 'https://www.viacidade.com.br/itinerario',
    ancoras: [
      // Jardim das Avenidas (graduação e administração) — ponto "Fr A Antiga Unisul"
      { nome: 'Unidade Jardim das Avenidas', lat: -28.9509, lon: -49.4676, raioM: 350 },
      // Mato Alto (pesquisa e extensão) — ponto "Fr Universidade Federal"
      { nome: 'Unidade Mato Alto', lat: -28.9484, lon: -49.4985, raioM: 280 },
    ],
    feriadosMunicipais: [],
  },
  {
    chave: 'curitibanos',
    nome: 'Curitibanos',
    fonte: { tipo: 'ufsc-curitibanos' },
    fontePublica: 'https://curitibanos.ufsc.br/?page_id=20481',
    ancoras: [{ nome: 'Sede (CBS-01)', lat: -27.2849, lon: -50.5348, raioM: 300 }],
    feriadosMunicipais: [],
  },
];
