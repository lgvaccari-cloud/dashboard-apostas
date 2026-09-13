# Painel de Apostas

Dashboard web que lê os dados direto da mesma planilha Google Sheets usada pelo
bot do Telegram, e mostra as métricas de performance (resultado líquido, ROI,
taxa de acerto, gráfico de resultado acumulado, filtro por tipster, etc).

Não escreve nada na planilha — só leitura.

## Variáveis de ambiente necessárias

| Variável | Descrição |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Conteúdo (JSON completo, numa linha só) da chave da service account — a mesma já usada pelo bot |
| `SHEET_ID` | ID da planilha (o mesmo do bot) |
| `SHEET_TAB_NAME` | Nome exato da aba/mês atual (o mesmo do bot) |
| `DASHBOARD_PASSWORD` | Senha de acesso ao dashboard |
| `FLASK_SECRET_KEY` | Qualquer string aleatória, usada para assinar o cookie de sessão |

Como a service account e a planilha já existem (usadas pelo bot), você só
precisa copiar o mesmo valor de `GOOGLE_SERVICE_ACCOUNT_JSON`, `SHEET_ID` e
`SHEET_TAB_NAME` que já estão configurados no serviço do bot no Render.

## Rodando localmente

```bash
pip install -r requirements.txt
export GOOGLE_SERVICE_ACCOUNT_JSON='{"type": "service_account", ...}'
export SHEET_ID="id_da_planilha"
export SHEET_TAB_NAME="Setembro"
export DASHBOARD_PASSWORD="escolha-uma-senha"
export FLASK_SECRET_KEY="qualquer-string-aleatoria"
python app.py
```

Depois abra http://localhost:5000

## Deploy no Render

1. Suba esta pasta para um repositório no GitHub.
2. No Render, clique em **New +** → **Web Service** e conecte o repositório.
3. Configurações do serviço:
   - **Runtime**: Python 3
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `gunicorn app:app`
   - **Plan**: Free
4. Em **Environment**, adicione as 5 variáveis da tabela acima (os mesmos
   valores de `GOOGLE_SERVICE_ACCOUNT_JSON`, `SHEET_ID` e `SHEET_TAB_NAME` que
   já estão no serviço do bot).
5. Deploy. Quando terminar, o Render te dá uma URL pública
   (algo como `https://painel-apostas.onrender.com`) — essa é a página com o
   login por senha.

**Nota sobre o plano Free do Render:** o serviço "dorme" depois de um tempo
sem uso, e a primeira visita depois disso demora ~30s para carregar (ele está
"acordando"). Isso é normal e não afeta os dados.

## Estrutura

```
app.py            → rotas Flask (login, logout, página, API /api/bets)
sheets.py          → lê e converte os dados da planilha do Google Sheets
templates/          → login.html, dashboard.html
static/style.css     → visual (sidebar escura, cards, gráfico)
static/dashboard.js  → busca os dados, calcula as métricas e desenha o gráfico
```

## Como as métricas são calculadas

- Considera **resolvida** qualquer aposta com "Resultado" = Green, Red ou
  Void; e **pendente** quando a coluna está em branco.
- **Resultado líquido / Lucro bruto / Prejuízo bruto**: somam a coluna "Uni"
  das apostas resolvidas.
- **ROI**: resultado líquido ÷ volume apostado (soma da Stake) das resolvidas.
- **Taxa de acerto**: Green ÷ (Green + Red) — apostas Void não entram na
  conta, só no total de "resolvidas".
- **Odd média**: média da coluna Odd de todas as apostas no filtro atual
  (resolvidas + pendentes).
- **Melhor tipster**: dentro do filtro atual, o tipster com maior soma de
  "Uni" entre as resolvidas.
- **Gráfico**: agrupa o resultado (Uni) por dia e desenha barras diárias +
  linha de soma acumulada.
