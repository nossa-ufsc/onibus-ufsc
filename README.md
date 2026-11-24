# onibus-ufsc

Linhas, horários e trajetos dos ônibus que passam pelos campi da UFSC, para o app Nossa UFSC.
Roda todo dia no GitHub Actions; as mudanças aparecem no histórico de `data/<campus>.json`.

| Campus | Fonte oficial | Coletor | Tempo até o ponto |
| --- | --- | --- | --- |
| Florianópolis (Trindade) | Consórcio Fênix, via API aberta do **Bus2/Mobilibus** (base do Floripa no Ponto) | `src/fontes/bus2.ts` | oficial (programação) |
| Blumenau (Salto do Norte + Velha) | BluMob, via API do **Bus2** | `src/fontes/bus2.ts` | oficial |
| Joinville (Perini) | **onibus.info** (Gidion/Transtusa), API JSON em formato GTFS | `src/fontes/onibusinfo.ts` | oficial (`stoptimes` da viagem) |
| Araranguá (Jardim das Avenidas + Mato Alto) | **Viação Cidade** (tarifa zero), tabela pública da Movitech | `src/fontes/movitech.ts` | estimado pela distância |
| Curitibanos (sede) | **ônibus interno da UFSC** (comunicado em PDF da Seção de Transportes) | `src/fontes/curitibanos.ts` | saída do CBS-01; volta ~10 min após sair do RU |

Os campi, as âncoras (ponto do campus = parada a até `raioM` de uma âncora) e os feriados municipais de
cada um ficam em `src/campi.ts`.

## Como funciona (Bus2 — Florianópolis e Blumenau)

Para cada campus de `src/campi.ts` (hash do projeto da cidade no Bus2 + âncoras com raio):

1. `routes` — todas as linhas da cidade.
2. `timetable` de cada linha — sentidos, serviços (dias úteis / sábados / domingos, com **validade**),
   partidas com a variante de trajeto (`seq`) e acessibilidade.
3. `trip-details` de cada viagem-modelo — desenho oficial (polyline) e paradas com o **tempo oficial desde a
   saída** (`int`, em segundos).
4. Ponto do campus = parada a até `raioM` de uma âncora. Linha do campus = alguma viagem para num ponto
   do campus. Linha nova entra e extinta sai sozinhas.
5. Mapeamento para o formato v1 que o app lê (`src/lib/types.ts`, `src/lib/montar.ts`):
   - sentido × variante → uma **origem** (aba de saída); o app liga horário ↔ trajeto por ela;
   - serviços → um **Quadro** por tipo de dia — só o vigente hoje (ou o próximo, se nenhum estiver);
   - viagem-modelo → **Trajeto** com os pontos do campus em ordem, `distanciaM` ao longo do desenho e
     `segundos` oficiais (o app deve preferir `segundos` à estimativa por distância).
6. **Validação** antes de gravar (`src/lib/validate.ts`): horários em ordem (uma virada de dia permitida —
   o Madrugadão vai de 00:45 a 04:25), toda origem com trajeto, desenho com pontos e a < 80 km do campus,
   ≥ 3 linhas e ≥ 1 ponto, no máximo 3 linhas sumindo de uma vez, nenhuma linha perdendo > 60% dos horários.
   Se falhar, nada daquele campus é gravado nem enviado; os outros campi seguem.
7. **Envio** — `POST {CONVEX_SITE_URL}/ingest/bus-lines`, um campus por vez, com o desenho cortado aos
   trechos a ≤ 1,8 km do campus (documento do Convex: máx. 1 MB; a coleta recusa > 900 KB).

### Joinville (onibus.info)

Paradas perto do campus (`stopsnear`) → linhas que param nelas (`stoproutes`) → por linha: sentidos e
desenhos (`routetrips`), partidas por ponto de saída e serviço DU/SAB/DOM (`timetable`), paradas em ordem
com distância (`shapestops`), desenho (`shapes`, polyline precisão 6) e o horário programado em cada parada
de uma viagem-modelo do meio-dia (`stoptimes/<viagem>`). Só entram as paradas que a viagem atende (o 0429
sai da "UFSC Perini" embora o desenho comece antes). A API exige `Referer: https://onibus.info/`.

### Araranguá (Movitech)

Tabela pública `view/schedules` (uma linha por viagem: trajeto, horário, itinerário, dias) + um POST por
trajeto em `schedule/standard-route/<id>` com o token CSRF da página. O desenho vem com **latitude/longitude
trocadas** (destrocado pelo valor). As listas de paradas são incompletas, então um trajeto também atende um
ponto do campus se passa a ≤ 30 m dele. Sem tempo por parada na fonte: o app estima pela distância.

### Curitibanos (PDF da UFSC)

Não há linha urbana com horário publicado. O coletor lê a página "Horários de ônibus" pela API do WordPress,
baixa o comunicado PDF vigente, extrai o texto (`unpdf`) e lê a tabela PERÍODO/SAÍDA/ORIGEM/DESTINO. Publica
as saídas do CBS-01 e as voltas para ele (RU, CEDUP e NCS ficam fora do mapa da sede). Comunicado com outro
formato faz a coleta falhar — conferir a página e ajustar `lerComunicado`.

Calculado aqui (as fontes não têm):

- **Quando a linha mudou** — hash do conteúdo; `alteradaEm` = primeira coleta com o conteúdo atual.
- **Feriados** — nenhuma fonte publica; `src/lib/feriados.ts` calcula os nacionais e os municipais de cada
  campus (operam como domingo) e vésperas de Natal/Ano-Novo e segunda de Carnaval (sábado).
- **Link oficial** — Florianópolis: página da linha no site do Fênix; Joinville: página da linha no
  onibus.info; demais: a tabela pública da operadora/UFSC.

## Rodar localmente

```bash
bun install
bun test                             # mapeamento e validação contra respostas reais salvas em test/fixtures
bun src/index.ts --dry-run           # todos os campi; coleta e valida, não grava nada
bun src/index.ts blumenau --skip-db  # um campus; grava data/blumenau.json, sem enviar
bun src/index.ts                     # grava e envia (precisa de CONVEX_SITE_URL e INGEST_API_KEY)
```

Uma coleta dos 5 campi faz ~1.500 requisições (no máximo 6 em paralelo) e leva ~1 min.

### Novo campus

Achar o projeto da cidade em `https://cdn.bus2.studio/api/projects`, pegar o `hash` em
`project-details?v=2&project_id=<id>` e acrescentar em `src/campi.ts` com âncoras/raio cobrindo o campus.
A `chave` tem de existir no enum `campus` do app. Araranguá (projeto 1034) existe no Bus2, mas só com 8
linhas — por isso lá a fonte é a Viação Cidade/Movitech.

## Workflows

| Workflow | Quando | O quê |
| --- | --- | --- |
| `onibus.yml` — Coletar Ônibus | todo dia 06:23 BRT + manual | coleta, valida, envia ao Convex e commita `data/` |
| `retry.yml` | quando o de cima falha | reexecuta em runner novo, até 3 tentativas |
| `keepalive.yml` | segunda 09:41 BRT | heartbeat em `data/keepalive.txt` |
| `ci.yml` | push / PR | typecheck + testes |

**Keep-alive:** o GitHub desativa workflows agendados após 60 dias sem atividade, e commits do
`GITHUB_TOKEN` não contam. Os commits usam uma **deploy key SSH** com escrita; a coleta commita
`data/last-run.txt` e `data/last-status.txt` todo dia, mesmo quando falha.

### Secrets

| Secret | Para quê |
| --- | --- |
| `BUS_COMMIT_SSH_KEY` | chave privada da deploy key (com write) — commits do keep-alive |
| `CONVEX_SITE_URL` | ex.: `https://<deployment>.convex.site` |
| `INGEST_API_KEY` | mesma chave dos outros pipelines (`INGEST_API_KEY` do Convex) |

Sem `CONVEX_SITE_URL`/`INGEST_API_KEY` a coleta roda, valida e commita o snapshot, só pula o envio.

## Riscos

Nenhuma das fontes tem API documentada: formato e endpoints podem mudar sem aviso. A validação e os testes
existem para que isso apareça como falha do workflow (com o app mantendo o último dado bom), nunca como
dado errado no app. Tempo real (`timetable-online`) existe na mesma API e fica para depois.
