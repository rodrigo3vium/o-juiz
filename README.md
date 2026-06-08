# O JUIZ — Tribunal da Razão

Avaliador de debates com IA (Claude). Cola uma conversa (texto livre ou export
de WhatsApp), a IA aponta falácias com nome técnico, faz o steelman de cada lado,
dá nota por critério, opcionalmente checa fatos na web e crava um vencedor.

Porte do artifact `o-juiz.jsx` (escrito para o sandbox de artifacts do Claude)
para um app **Next.js (App Router)** real e executável.

## Como rodar

```bash
npm install
cp .env.local.example .env.local   # e preencha a ANTHROPIC_API_KEY
npm run dev                         # http://localhost:3000
```

Pegue a chave em https://platform.claude.com/.

## Como funciona

- **Front-end** (`app/page.jsx`): client component com a UI. Histórico e ranking
  persistem no `localStorage` do navegador.
- **Back-end** (`app/api/judge/route.js`): route handler que chama a Messages API
  via SDK oficial `@anthropic-ai/sdk`. **A chave fica só no servidor** — o navegador
  nunca a vê.

O original chamava `api.anthropic.com` direto do browser, sem chave, e usava
`window.storage` — duas APIs que só existem no sandbox de artifacts. Ambas foram
substituídas pelos equivalentes reais.

## Deploy (Vercel)

```bash
vercel
printf "sk-ant-..." | vercel env add ANTHROPIC_API_KEY production
vercel --prod
```

> `printf`, nunca `echo` — `echo` adiciona `\n` no fim e corrompe a chave.

## Decisões tomadas

- **Stack: Next.js App Router (JS, não TS).** Precisava de um proxy server-side
  para a chave da API; Next dá front + rota de API no mesmo framework, igual em
  dev e prod, e faz deploy direto na Vercel (stack que o Rodrigo já usa). JS para
  bater com o `.jsx` original — sem overhead de TypeScript.
- **Modelo: `claude-opus-4-8`** (configurável via `JUDGE_MODEL`). O original
  apontava para `claude-sonnet-4-20250514`, que está depreciado. Opus 4.8 entrega
  o raciocínio mais afiado para a tarefa do Juiz (falácias, steelman, nuance).
  Para reduzir custo, é só setar `JUDGE_MODEL=claude-sonnet-4-6` no `.env.local`.
- **Adaptive thinking + effort `high`.** Tarefa de julgamento é "razoavelmente
  complexa" — modo de raciocínio adaptativo melhora a qualidade do veredicto.
- **Web search `web_search_20260209`** (era `web_search_20250305`). A versão atual
  faz filtragem dinâmica dos resultados nos modelos Opus, mais preciso e econômico.
- **`max_tokens` 16000, sem streaming.** Folga para raciocínio + JSON do veredicto,
  dentro do teto seguro de timeout de requisições não-streaming.
- **Persistência: `localStorage`** no lugar de `window.storage`. Histórico fica
  no navegador do usuário (até 50 julgamentos), igual ao comportamento original.
- **Extração de JSON no servidor.** A rota tolera cercas de código residuais e
  loop de `pause_turn` (quando a busca na web pausa após N iterações).

## Estrutura

```
app/
  layout.jsx          metadata + html/body
  globals.css         reset de altura
  page.jsx            O JUIZ (UI completa, client component)
  api/judge/route.js  proxy server-side para a Claude Messages API
```
