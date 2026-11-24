// Campi atendidos e de onde vêm os dados. `projeto` = hash do projeto da cidade na API aberta do Bus2
// (Mobilibus), a mesma base do app Floripa no Ponto e da tabela da BluMob. Lista de cidades:
// https://cdn.bus2.studio/api/projects (o hash sai de project-details?v=2&project_id=<id>).
//
// Um ponto de ônibus é "do campus" se fica a até `raioM` de alguma âncora — e a linha entra se
// alguma viagem dela para num ponto do campus.

export interface Campus {
  /** Mesmo enum `campus` do app (convex/validators.ts). */
  chave: 'florianopolis' | 'blumenau';
  nome: string;
  projeto: string;
  /** Página pública da tabela, para a pessoa conferir. */
  fontePublica: string;
  ancoras: { nome: string; lat: number; lon: number; raioM: number }[];
  /** Linhas a ignorar pelo número (ex.: fretamentos que não são para o público). */
  ignorar?: RegExp;
}

export const CAMPI: Campus[] = [
  {
    chave: 'florianopolis',
    nome: 'Florianópolis · Trindade',
    projeto: '4pbxo',
    fontePublica: 'https://www.consorciofenix.com.br/horarios',
    ancoras: [
      { nome: 'Campus Trindade', lat: -27.6005, lon: -48.5195, raioM: 750 },
      // ponta oeste (CFH/Serrinha: Rua Douglas Seabra Levier e Marcus Aurélio Homem)
      { nome: 'Campus Trindade · oeste', lat: -27.5968, lon: -48.5258, raioM: 300 },
    ],
  },
  {
    chave: 'blumenau',
    nome: 'Blumenau',
    projeto: '5f1lx',
    fontePublica: 'https://bus2.info/reports/2you/5f1lx',
    // 13xx = "Linha Trabalhador": fretamento para empresas, não é linha que o aluno pega
    ignorar: /^13\d\d$/,
    ancoras: [
      // sede Salto do Norte (Rua Marechal Rondon, 880) — em frente ao Terminal do Aterro
      { nome: 'Sede Salto do Norte', lat: -26.8725, lon: -49.0947, raioM: 350 },
      // sede Velha (Rua João Pessoa, 2750) — laboratórios
      { nome: 'Sede Velha', lat: -26.9207, lon: -49.0988, raioM: 250 },
    ],
  },
];
