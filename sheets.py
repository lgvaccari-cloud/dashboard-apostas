import os
import json
from datetime import datetime
import gspread
from google.oauth2.service_account import Credentials

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets.readonly",
]

# Nomes das colunas na ordem exata da planilha (A -> N)
COLUMNS = [
    "data", "casa", "tipster", "aposta", "tipo", "mercado",
    "resultado", "stake", "odd", "aposta_reais", "lucro", "uni",
    "bank", "cresc_pct",
]


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


def _parse_bets_from_rows(rows, mes_label):
    """Extrai as apostas de uma aba já lida (rows), marcando cada aposta com
    o nome da aba de origem (mes_label). Retorna [] se a aba não tiver a
    tabela de apostas (sem cabeçalho 'Tipster')."""
    data_start_row, data_col = _find_table_start(rows)
    if data_col is None:
        return []

    bets = []
    for row in rows[data_start_row:]:
        row_slice = row[data_col:data_col + len(COLUMNS)]
        if len(row_slice) < len(COLUMNS):
            row_slice = row_slice + [""] * (len(COLUMNS) - len(row_slice))
        record = dict(zip(COLUMNS, row_slice))

        if not record["data"].strip() and not record["casa"].strip():
            continue  # linha vazia

        parsed_date = _parse_date(record["data"])

        bet = {
            "mes": mes_label,
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


def fetch_bets():
    """Lê TODAS as abas da planilha (uma por mês) e devolve uma lista única
    de apostas, cada uma marcada com o mês (nome da aba) de origem.

    Abas que não tiverem a tabela de apostas (sem o cabeçalho 'Tipster') são
    ignoradas silenciosamente — assim uma aba extra/diferente na planilha não
    quebra a leitura.
    """
    client = _get_client()
    sheet_id = os.environ["SHEET_ID"]

    sh = client.open_by_key(sheet_id)

    all_bets = []
    for ws in sh.worksheets():
        rows = ws.get_all_values()
        all_bets.extend(_parse_bets_from_rows(rows, ws.title))

    if not all_bets:
        raise RuntimeError(
            "Não encontrei nenhuma aba com o cabeçalho 'Tipster' na planilha — "
            "confira se o SHEET_ID está certo e se as abas têm a mesma estrutura de colunas."
        )

    return all_bets
