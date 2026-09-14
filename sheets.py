import os
import json
import time
from datetime import datetime
import gspread
from google.oauth2.service_account import Credentials

# precisa de escrita agora (marcar resultado / editar apostas), não só leitura
SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
]

# cache curto em memória: evita reler a planilha inteira a cada carregamento
# de página — só busca de novo depois de expirar (ou depois de uma edição)
_CACHE_TTL_SEGUNDOS = 20
_cache = {"bets": None, "ts": 0}

# Nomes das colunas na ordem exata da planilha (A -> N)
COLUMNS = [
    "data", "casa", "tipster", "aposta", "tipo", "mercado",
    "resultado", "stake", "odd", "aposta_reais", "lucro", "uni",
    "bank", "cresc_pct",
]

# Campos que podem ser editados pelo dashboard. Os demais (aposta_reais,
# lucro, uni, bank, cresc_pct) são fórmulas calculadas na própria planilha e
# nunca devem ser sobrescritos.
EDITABLE_FIELDS = {
    "data", "casa", "tipster", "aposta", "tipo", "mercado", "resultado",
    "stake", "odd",
}


def _get_client():
    """Autentica no Google Sheets usando a service account.

    Espera a variável de ambiente GOOGLE_SERVICE_ACCOUNT_JSON com o
    conteúdo (JSON completo) da chave da service account.
    """
    raw = os.environ["GOOGLE_SERVICE_ACCOUNT_JSON"]
    info = json.loads(raw)
    creds = Credentials.from_service_account_info(info, scopes=SCOPES)
    return gspread.authorize(creds)


def _to_float(value):
    """Converte valores no formato brasileiro (1.234,56 ou 1,25) para float."""
    if value is None:
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    s = str(value).strip()
    if s == "" or s == "-":
        return 0.0
    s = s.replace("R$", "").strip()
    # remove separador de milhar e troca vírgula decimal por ponto
    s = s.replace(".", "").replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return 0.0


def _parse_date(value):
    """Tenta converter a coluna Data (string) num objeto date. Retorna None se falhar."""
    if not value:
        return None
    s = str(value).strip()
    for fmt in ("%d/%m/%Y", "%d/%m/%y", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def _find_table_start(rows):
    """Acha em qual (linha, coluna) começa a tabela de apostas, procurando o
    cabeçalho "Tipster" na planilha. A planilha tem um bloco de resumo nas
    primeiras colunas, então a tabela de apostas não começa na coluna A.

    Retorna (indice_da_linha_de_dados, indice_da_coluna_data) ou (None, None)
    se não achar.
    """
    for row_idx, row in enumerate(rows):
        for col_idx, cell in enumerate(row):
            if cell.strip().lower() == "tipster":
                # "Data" e "Casa" ficam duas e uma coluna antes de "Tipster"
                data_col_idx = col_idx - 2
                if data_col_idx < 0:
                    continue
                return row_idx + 1, data_col_idx
    return None, None


def _find_label_value(rows, label):
    """Procura uma célula com o texto exato de `label` (ex: "ROI %") em
    qualquer lugar da aba, e devolve o próximo valor não vazio na mesma
    linha (o bloco de resumo tem o rótulo numa coluna e o valor logo depois,
    às vezes numa célula mesclada). Devolve None se não achar."""
    label_lower = label.strip().lower()
    for row in rows:
        for col_idx, cell in enumerate(row):
            if cell.strip().lower() == label_lower:
                for next_cell in row[col_idx + 1:]:
                    if next_cell.strip():
                        return next_cell.strip()
    return None


def _parse_bets_from_rows(rows, mes_label):
    """Extrai as apostas de uma aba já lida (rows), marcando cada aposta com
    o nome da aba de origem (mes_label) e a linha absoluta na planilha (pra
    dar pra editar/marcar resultado depois). Retorna [] se a aba não tiver a
    tabela de apostas (sem cabeçalho 'Tipster')."""
    data_start_row, data_col = _find_table_start(rows)
    if data_col is None:
        return []

    roi_pct = _find_label_value(rows, "ROI %") or ""

    bets = []
    for i, row in enumerate(rows[data_start_row:]):
        row_slice = row[data_col:data_col + len(COLUMNS)]
        if len(row_slice) < len(COLUMNS):
            row_slice = row_slice + [""] * (len(COLUMNS) - len(row_slice))
        record = dict(zip(COLUMNS, row_slice))

        if not record["data"].strip() and not record["casa"].strip():
            continue  # linha vazia

        parsed_date = _parse_date(record["data"])
        sheet_row = data_start_row + i + 1  # linha absoluta na planilha (1-based)

        bet = {
            "mes": mes_label,
            "mes_roi_pct": roi_pct,
            "row": sheet_row,
            "data": record["data"].strip(),
            "data_iso": parsed_date.isoformat() if parsed_date else None,
            "casa": record["casa"].strip(),
            "tipster": record["tipster"].strip(),
            "aposta": record["aposta"].strip(),
            "tipo": record["tipo"].strip(),
            "mercado": record["mercado"].strip(),
            "resultado": record["resultado"].strip(),  # Green / Red / Void / "" (pendente)
            "stake": _to_float(record["stake"]),
            "odd": _to_float(record["odd"]),
            "lucro_uni": _to_float(record["uni"]),
            "stake_reais": _to_float(record["aposta_reais"]),
            "lucro_reais": _to_float(record["lucro"]),
        }
        bets.append(bet)

    return bets


def fetch_bets(force=False):
    """Lê TODAS as abas da planilha (uma por mês) e devolve uma lista única
    de apostas, cada uma marcada com o mês (nome da aba) de origem.

    Usa um cache curto em memória (`_CACHE_TTL_SEGUNDOS`) pra não reler a
    planilha inteira a cada carregamento de página. Passe force=True pra
    ignorar o cache e buscar de verdade (usado pelo botão de atualizar).

    Busca os dados de todas as abas numa ÚNICA chamada à API (batch get), em
    vez de uma chamada por aba — isso é o que faz o carregamento ser rápido
    mesmo com vários meses na planilha.

    Abas que não tiverem a tabela de apostas (sem o cabeçalho 'Tipster') são
    ignoradas silenciosamente — assim uma aba extra/diferente na planilha não
    quebra a leitura.
    """
    agora = time.time()
    if not force and _cache["bets"] is not None and (agora - _cache["ts"]) < _CACHE_TTL_SEGUNDOS:
        return _cache["bets"]

    client = _get_client()
    sheet_id = os.environ["SHEET_ID"]

    sh = client.open_by_key(sheet_id)
    titles = [ws.title for ws in sh.worksheets()]

    ranges = [f"'{title}'" for title in titles]
    batch = sh.values_batch_get(ranges)
    value_ranges = batch.get("valueRanges", [])

    all_bets = []
    for title, value_range in zip(titles, value_ranges):
        rows = value_range.get("values", [])
        all_bets.extend(_parse_bets_from_rows(rows, title))

    if not all_bets:
        raise RuntimeError(
            "Não encontrei nenhuma aba com o cabeçalho 'Tipster' na planilha — "
            "confira se o SHEET_ID está certo e se as abas têm a mesma estrutura de colunas."
        )

    _cache["bets"] = all_bets
    _cache["ts"] = agora
    return all_bets


def _find_bancas_table(rows):
    """Acha a linha de cabeçalho e as colunas Casa/Status/Total Banca da
    tabela de contas por casa de apostas (uma tabela separada da de apostas,
    em outra área da mesma aba).

    Retorna (linha_de_dados, col_casa, col_status, col_total_banca), ou
    (None, None, None, None) se não achar.
    """
    for row_idx, row in enumerate(rows):
        lower = [c.strip().lower() for c in row]
        if "casa" in lower and "status" in lower and "total banca" in lower:
            return (
                row_idx + 1,
                lower.index("casa"),
                lower.index("status"),
                lower.index("total banca"),
            )
    return None, None, None, None


def fetch_bancas_for_mes(mes):
    """Lê a tabela de contas/bancas por casa de apostas dentro da aba `mes`,
    soma o "Total Banca" das contas com Status "Ativa", agrupado por Casa.

    Devolve uma lista de dicts [{"casa", "banca", "contas"}], ordenada da
    maior banca pra menor. Devolve [] se não achar essa tabela na aba.
    """
    client = _get_client()
    sheet_id = os.environ["SHEET_ID"]
    sh = client.open_by_key(sheet_id)
    ws = sh.worksheet(mes)
    rows = ws.get_all_values()

    data_start_row, col_casa, col_status, col_total_banca = _find_bancas_table(rows)
    if col_casa is None:
        return []

    max_col = max(col_casa, col_status, col_total_banca)
    somas = {}
    contas = {}
    for row in rows[data_start_row:]:
        if len(row) <= max_col:
            continue
        casa = row[col_casa].strip()
        status = row[col_status].strip().lower()
        if not casa or status != "ativa":
            continue
        valor = _to_float(row[col_total_banca])
        somas[casa] = somas.get(casa, 0.0) + valor
        contas[casa] = contas.get(casa, 0) + 1

    resultado = [
        {"casa": casa, "banca": somas[casa], "contas": contas[casa]}
        for casa in somas
    ]
    resultado.sort(key=lambda x: x["banca"], reverse=True)
    return resultado


def fetch_bets_for_mes(mes):
    """Lê só a aba (mês) indicada e devolve as apostas dela.

    Bem mais rápido que fetch_bets() porque não varre a planilha inteira —
    usado depois de marcar resultado ou editar uma aposta, quando só
    precisamos re-sincronizar aquele mês específico.
    """
    client = _get_client()
    sheet_id = os.environ["SHEET_ID"]
    sh = client.open_by_key(sheet_id)
    ws = sh.worksheet(mes)
    rows = ws.get_all_values()
    return _parse_bets_from_rows(rows, mes)


def update_bet(mes, row, updates):
    """Atualiza um ou mais campos de uma aposta já existente, escrevendo
    direto na planilha (aba `mes`, linha `row`).

    `updates` é um dict {campo: valor} usando os mesmos nomes de COLUMNS
    (ex: {"resultado": "Green"}, ou {"odd": "1,85", "stake": "0,75"}).
    Campos que são fórmula na planilha (aposta_reais, lucro, uni, bank,
    cresc_pct) são ignorados silenciosamente, nunca sobrescritos.
    """
    client = _get_client()
    sheet_id = os.environ["SHEET_ID"]
    sh = client.open_by_key(sheet_id)
    ws = sh.worksheet(mes)

    # relê o cabeçalho dessa aba pra saber exatamente em qual coluna cada
    # campo cai (auto-corrige se a planilha for reorganizada)
    rows = ws.get_all_values()
    _, data_col = _find_table_start(rows)
    if data_col is None:
        raise RuntimeError(f"Não encontrei a tabela de apostas na aba '{mes}'.")

    for field, value in updates.items():
        if field not in EDITABLE_FIELDS:
            continue
        col_idx = COLUMNS.index(field)
        col_num = data_col + col_idx + 1  # 1-based
        cell_a1 = gspread.utils.rowcol_to_a1(row, col_num)
        ws.update(range_name=cell_a1, values=[[value]], value_input_option="USER_ENTERED")

    _cache["bets"] = None  # invalida o cache — a próxima leitura completa busca de novo


def add_bet(mes, fields):
    """Adiciona uma aposta nova na aba `mes`, na primeira linha vazia depois
    da última aposta existente.

    Só preenche os campos até Odd (Data, Casa, Tipster, Aposta, Tipo,
    Mercado, Resultado, Stake, Odd) — as colunas de fórmula (Aposta R$,
    Lucro, Uni, Bank, Cresc%) devem já estar prontas na planilha (copiadas
    pra baixo com antecedência), do mesmo jeito que o bot do Telegram
    também só preenche até a Odd.

    `fields` é um dict com as chaves: data, casa, tipster, aposta, tipo,
    mercado, resultado, stake, odd.
    """
    client = _get_client()
    sheet_id = os.environ["SHEET_ID"]
    sh = client.open_by_key(sheet_id)
    ws = sh.worksheet(mes)

    rows = ws.get_all_values()
    data_start_row, data_col = _find_table_start(rows)
    if data_col is None:
        raise RuntimeError(f"Não encontrei a tabela de apostas na aba '{mes}'.")

    # acha a primeira linha vazia (sem Data) a partir do início da tabela
    next_row = None
    for i, row in enumerate(rows[data_start_row:]):
        data_val = row[data_col].strip() if len(row) > data_col else ""
        if not data_val:
            next_row = data_start_row + i + 1
            break
    if next_row is None:
        next_row = data_start_row + len(rows[data_start_row:]) + 1

    order = ["data", "casa", "tipster", "aposta", "tipo", "mercado", "resultado", "stake", "odd"]
    values = [[fields.get(f, "") for f in order]]
    start_a1 = gspread.utils.rowcol_to_a1(next_row, data_col + 1)
    end_a1 = gspread.utils.rowcol_to_a1(next_row, data_col + len(order))
    ws.update(range_name=f"{start_a1}:{end_a1}", values=values, value_input_option="USER_ENTERED")

    _cache["bets"] = None
    return next_row
