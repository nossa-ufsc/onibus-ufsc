# onibus-ufsc

Linhas, horários e trajetos dos ônibus que passam pelos campi da UFSC, para o app Nossa UFSC.
Hoje: **Florianópolis (Trindade)** e **Blumenau** (sedes Salto do Norte e Velha).

Fonte: a **API aberta do Bus2/Mobilibus** (`https://cdn.bus2.studio/api`), onde as operadoras publicam
a programação oficial — é a mesma base do app Floripa no Ponto (Consórcio Fênix) e da tabela da BluMob.
Roda todo dia no GitHub Actions; as mudanças aparecem no histórico de `data/<campus>.json`.

## Como funciona

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

Calculado aqui (a fonte não tem):

- **Quando a linha mudou** — hash do conteúdo; `alteradaEm` = primeira coleta com o conteúdo atual.
- **Feriados** — as exceções da API vêm vazias; `src/lib/feriados.ts` calcula feriados nacionais e de
  Florianópolis (operam como domingo) e vésperas de Natal/Ano-Novo e segunda de Carnaval (sábado).
- **Link oficial** — Florianópolis aponta para a página da linha no site do Fênix; Blumenau, para a tabela
  pública da BluMob.

## Rodar localmente

```bash
bun install
bun test                             # mapeamento e validação contra respostas reais salvas em test/fixtures
bun src/index.ts --dry-run           # todos os campi; coleta e valida, não grava nada
bun src/index.ts blumenau --skip-db  # um campus; grava data/blumenau.json, sem enviar
bun src/index.ts                     # grava e envia (precisa de CONVEX_SITE_URL e INGEST_API_KEY)
```

Uma coleta faz ~1.400 requisições à API (6 em paralelo, cache de CDN) e leva ~1 min.

### Novo campus

Achar o projeto da cidade em `https://cdn.bus2.studio/api/projects`, pegar o `hash` em
`project-details?v=2&project_id=<id>` e acrescentar em `src/campi.ts` com âncoras/raio cobrindo o campus.
A `chave` tem de existir no enum `campus` do app. Araranguá (projeto 1034) existe no Bus2, mas só com 8
linhas — a fonte completa lá é a Viação Cidade/Movitech.

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

A API do Bus2 não é documentada: formato e endpoints podem mudar sem aviso. A validação e os testes
existem para que isso apareça como falha do workflow (com o app mantendo o último dado bom), nunca como
dado errado no app. Tempo real (`timetable-online`) existe na mesma API e fica para depois.
