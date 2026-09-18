import os
import json
import re
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

# Nomes das colunas na ordem exata da planilha (A -> O)
COLUMNS = [
    "data", "casa", "tipster", "aposta", "tipo", "mercado",
    "resultado", "stake", "odd", "aposta_reais", "lucro", "uni",
    "bank", "cresc_pct", "horario",
]

# Campos que podem ser editados pelo dashboard. Os demais (aposta_reais,
# lucro, uni, bank, cresc_pct) são fórmulas calculadas na própria planilha e
# nunca devem ser sobrescritos.
EDITABLE_FIELDS = {
    "data", "casa", "tipster", "aposta", "tipo", "mercado", "resultado",
    "stake", "odd", "horario",
}


def _get_or_create_worksheet(nome_aba, headers):
    """Pega uma aba pelo nome (ex: 'Tipsters', 'Casas'), criando com o
    cabeçalho certo se ela ainda não existir na planilha."""
    client = _get_client()
    sheet_id = os.environ["SHEET_ID"]
    sh = client.open_by_key(sheet_id)
    try:
        return sh.worksheet(nome_aba)
    except gspread.exceptions.WorksheetNotFound:
        ws = sh.add_worksheet(title=nome_aba, rows=200, cols=max(len(headers), 2))
        ws.update(range_name="A1", values=[headers])
        return ws


# ---------- Cadastro de tipsters (Configurações > Tipsters) ----------

TIPOS_TIPSTER_VALIDOS = {"Pré", "Live", "Pré + Live"}


def listar_tipsters():
    """[{nome, status, tipo}], status sempre "Ativo" ou "Inativo"."""
    ws = _get_or_create_worksheet("Tipsters", ["Nome", "Status", "Tipo"])
    rows = ws.get_all_values()[1:]
    return [
        {
            "nome": r[0].strip(),
            "status": (r[1].strip() if len(r) > 1 and r[1].strip() else "Ativo"),
            "tipo": (r[2].strip() if len(r) > 2 and r[2].strip() else ""),
        }
        for r in rows if r and r[0].strip()
    ]


def adicionar_tipster(nome, tipo):
    nome = (nome or "").strip()
    if not nome:
        raise ValueError("Nome não pode ficar vazio.")
    if tipo not in TIPOS_TIPSTER_VALIDOS:
        raise ValueError("Escolha se o tipster é Pré, Live ou Pré + Live.")
    ws = _get_or_create_worksheet("Tipsters", ["Nome", "Status", "Tipo"])
    existentes = [r[0].strip().lower() for r in ws.get_all_values()[1:] if r and r[0].strip()]
    if nome.lower() in existentes:
        raise ValueError("Esse tipster já está cadastrado.")
    ws.append_row([nome, "Ativo", tipo], value_input_option="USER_ENTERED")



def atualizar_status_tipster(nome, status):
    if status not in ("Ativo", "Inativo"):
        raise ValueError("Status inválido.")
    ws = _get_or_create_worksheet("Tipsters", ["Nome", "Status", "Tipo"])
    rows = ws.get_all_values()
    for i, r in enumerate(rows[1:], start=2):
        if r and r[0].strip().lower() == (nome or "").strip().lower():
            ws.update(range_name=f"B{i}", values=[[status]])
            return
    raise ValueError("Tipster não encontrado.")


def remover_tipster(nome):
    ws = _get_or_create_worksheet("Tipsters", ["Nome", "Status", "Tipo"])
    rows = ws.get_all_values()
    for i, r in enumerate(rows[1:], start=2):
        if r and r[0].strip().lower() == (nome or "").strip().lower():
            ws.delete_rows(i)
            return
    raise ValueError("Tipster não encontrado.")


# ---------- Cadastro de casas (Configurações > Casas) ----------

def listar_casas():
    ws = _get_or_create_worksheet("Casas", ["Nome"])
    rows = ws.get_all_values()[1:]
    return [r[0].strip() for r in rows if r and r[0].strip()]


def adicionar_casa(nome):
    nome = (nome or "").strip()
    if not nome:
        raise ValueError("Nome não pode ficar vazio.")
    ws = _get_or_create_worksheet("Casas", ["Nome"])
    existentes = [r[0].strip().lower() for r in ws.get_all_values()[1:] if r and r[0].strip()]
    if nome.lower() in existentes:
        raise ValueError("Essa casa já está cadastrada.")
    ws.append_row([nome], value_input_option="USER_ENTERED")


def remover_casa(nome):
    ws = _get_or_create_worksheet("Casas", ["Nome"])
    rows = ws.get_all_values()
    for i, r in enumerate(rows[1:], start=2):
        if r and r[0].strip().lower() == (nome or "").strip().lower():
            ws.delete_rows(i)
            return
    raise ValueError("Casa não encontrada.")


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
    """Converte valores no formato brasileiro (1.234,56 ou 1,25) para float.

    Aceita as variações que o Google Sheets devolve como texto, incluindo
    "-R$ 1.875,00", "R$ -1.875,00" e "(R$ 1.875,00)" — todas negativas.
    """
    if value is None:
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    s = str(value).strip()
    if s == "" or s == "-":
        return 0.0
    # tira símbolo de moeda e qualquer espaço (inclusive o não-quebrável do Sheets)
    s = s.replace("R$", "").replace("\u00a0", "").replace(" ", "")
    negativo = False
    if s.startswith("(") and s.endswith(")"):
        negativo = True
        s = s[1:-1]
    # remove separador de milhar e troca vírgula decimal por ponto
    s = s.replace(".", "").replace(",", ".")
    try:
        numero = float(s)
    except ValueError:
        return 0.0
    return -numero if negativo else numero


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


def _raw_cell(raw_rows, row_idx, col_idx):
    """Lê uma célula de `raw_rows` (leitura UNFORMATTED_VALUE) com segurança
    — devolve None se a linha/coluna não existir nesse recorte."""
    if raw_rows is None or row_idx >= len(raw_rows):
        return None
    row = raw_rows[row_idx]
    if col_idx >= len(row):
        return None
    return row[col_idx]


# Colunas numéricas onde a formatação de exibição da planilha (ex: só 2 casas
# decimais na coluna Stake) pode arredondar o valor ANTES da gente ler —
# "0,375" vira o texto "0,38" na leitura formatada, e 0.38*1000 dá 380 em vez
# de 375. Pra essas colunas, preferimos o valor não-formatado quando
# disponível (número puro, sem arredondamento de exibição).
_CAMPOS_PRECISOS = {"stake", "odd", "uni", "aposta_reais", "lucro"}


def _normaliza_horario_sort(horario: str) -> str:
    """Extrai "HH:MM" com zero à esquerda pra poder ordenar como texto — aceita
    o que a pessoa digitar na mão ("9:5", "19:45", "19:45:00", "9h30").
    Não reconhecendo nada, devolve "00:00" (fica no início do dia, neutro)."""
    if not horario:
        return "00:00"
    m = re.search(r"(\d{1,2})[:h](\d{1,2})", horario)
    if not m:
        return "00:00"
    h, mi = int(m.group(1)), int(m.group(2))
    if not (0 <= h <= 23 and 0 <= mi <= 59):
        return "00:00"
    return f"{h:02d}:{mi:02d}"


def _parse_bets_from_rows(rows, mes_label, raw_rows=None):
    """Extrai as apostas de uma aba já lida (rows), marcando cada aposta com
    o nome da aba de origem (mes_label) e a linha absoluta na planilha (pra
    dar pra editar/marcar resultado depois). Retorna [] se a aba não tiver a
    tabela de apostas (sem cabeçalho 'Tipster').

    `raw_rows`, se fornecido, é a MESMA aba lida com UNFORMATTED_VALUE — usado
    só para os campos numéricos (ver _CAMPOS_PRECISOS), pra não perder casas
    decimais por causa da formatação de exibição da célula.
    """
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

        abs_row_idx = data_start_row + i
        for campo in _CAMPOS_PRECISOS:
            bruto = _raw_cell(raw_rows, abs_row_idx, data_col + COLUMNS.index(campo))
            if bruto not in (None, ""):
                record[campo] = bruto

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
            "horario": record["horario"].strip(),
            # combina data+hora numa string ordenável ("2026-09-15T19:45") —
            # é isso que a lista usa pra ordenar certinho dentro do mesmo dia
            "data_hora_sort": (parsed_date.isoformat() if parsed_date else "0000-00-00")
                + "T" + _normaliza_horario_sort(record["horario"].strip()),
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

    # segunda leitura, sem a formatação de exibição de cada célula — usada só
    # pros campos numéricos (ver _CAMPOS_PRECISOS), pra não perder casas
    # decimais que a formatação da planilha (ex: Stake com 2 casas) esconde.
    raw_batch = sh.values_batch_get(ranges, params={"valueRenderOption": "UNFORMATTED_VALUE"})
    raw_value_ranges = raw_batch.get("valueRanges", [])

    all_bets = []
    for title, value_range, raw_value_range in zip(titles, value_ranges, raw_value_ranges):
        rows = value_range.get("values", [])
        raw_rows = raw_value_range.get("values", [])
        all_bets.extend(_parse_bets_from_rows(rows, title, raw_rows))

    if not all_bets:
        raise RuntimeError(
            "Não encontrei nenhuma aba com o cabeçalho 'Tipster' na planilha — "
            "confira se o SHEET_ID está certo e se as abas têm a mesma estrutura de colunas."
        )

    _cache["bets"] = all_bets
    _cache["ts"] = agora
    return all_bets


def _find_bancas_table(rows):
    """Acha a linha de cabeçalho e as colunas Casa/Nome/Status/Total Banca da
    tabela de contas por casa de apostas (uma tabela separada da de apostas,
    em outra área da mesma aba).

    Retorna (linha_de_dados, dict_de_colunas), ou (None, None) se não achar.
    """
    for row_idx, row in enumerate(rows):
        lower = [c.strip().lower() for c in row]
        if "casa" in lower and "status" in lower and "total banca" in lower:
            cols = {
                "casa": lower.index("casa"),
                "status": lower.index("status"),
                "total_banca": lower.index("total banca"),
            }
            if "nome" in lower:
                cols["nome"] = lower.index("nome")
            # "final" casa exato — não confunde com "total final"
            if "final" in lower:
                cols["final"] = lower.index("final")
            # coluna de lucro em reais — ignora a de unidades ("Lucro (u)")
            for i, cabecalho in enumerate(lower):
                if cabecalho.startswith("lucro") and "(u)" not in cabecalho:
                    cols["lucro"] = i
                    break
            return row_idx + 1, cols
    return None, None


def fetch_bancas_for_mes(mes):
    """Lê a tabela de contas/bancas por casa de apostas dentro da aba `mes`.

    Devolve um dict com:
      - "resumo": [{"casa", "banca", "contas", "lucro"}] — por Casa: soma do
        "Total Banca" e contagem apenas das contas com Status "Ativa", mais a
        soma do "Lucro (BRL)" de TODAS as contas (ativas e finalizadas).
        Casas que só têm conta finalizada aparecem com banca 0.
      - "contas": [{"casa", "nome", "banca", "row"}] — cada conta ativa
        individualmente, com o número da linha na planilha (pra editar).

    Devolve {"resumo": [], "contas": []} se não achar essa tabela na aba.
    """
    client = _get_client()
    sheet_id = os.environ["SHEET_ID"]
    sh = client.open_by_key(sheet_id)
    ws = sh.worksheet(mes)
    rows = ws.get_all_values()

    data_start_row, cols = _find_bancas_table(rows)
    if cols is None:
        return {"resumo": [], "contas": []}

    col_casa = cols["casa"]
    col_status = cols["status"]
    col_banca = cols["total_banca"]
    col_nome = cols.get("nome")
    col_lucro = cols.get("lucro")
    col_final = cols.get("final")

    def cell(row, idx):
        if idx is None or idx >= len(row):
            return ""
        return row[idx].strip()

    contas = []
    somas = {}
    qtd = {}
    lucros = {}

    for i, row in enumerate(rows[data_start_row:]):
        casa = cell(row, col_casa)
        if not casa:
            continue
        sheet_row = data_start_row + i + 1

        # a casa entra no resumo mesmo sem nenhuma conta ativa
        somas.setdefault(casa, 0.0)
        qtd.setdefault(casa, 0)
        lucros.setdefault(casa, 0.0)

        # lucro soma TODAS as contas da casa (ativas e finalizadas)
        if col_lucro is not None:
            lucros[casa] += _to_float(cell(row, col_lucro))

        # banca e contagem de contas continuam só com as ativas
        if cell(row, col_status).lower() != "ativa":
            continue
        valor = _to_float(cell(row, col_banca))
        somas[casa] += valor
        qtd[casa] += 1
        contas.append({
            "casa": casa,
            "nome": cell(row, col_nome),
            "banca": valor,
            "final": _to_float(cell(row, col_final)),
            "row": sheet_row,
        })

    resumo = [
        {"casa": casa, "banca": somas[casa], "contas": qtd[casa], "lucro": lucros[casa]}
        for casa in somas
    ]
    resumo.sort(key=lambda x: (x["banca"], x["lucro"]), reverse=True)

    return {"resumo": resumo, "contas": contas}


def update_banca(mes, row, valor):
    """Atualiza o valor de "Final" (saldo atual da conta) de uma conta
    específica (linha) na tabela de contas/bancas dessa aba.

    "Total Banca" NÃO é editada aqui — "Final" é o saldo que alimenta o
    cálculo de Lucro na planilha.
    """
    client = _get_client()
    sheet_id = os.environ["SHEET_ID"]
    sh = client.open_by_key(sheet_id)
    ws = sh.worksheet(mes)
    rows = ws.get_all_values()

    _, cols = _find_bancas_table(rows)
    if cols is None:
        raise RuntimeError(f"Não encontrei a tabela de bancas na aba '{mes}'.")
    if "final" not in cols:
        raise RuntimeError(
            f"Não encontrei a coluna 'Final' na tabela de bancas da aba '{mes}'."
        )

    col_num = cols["final"] + 1  # 1-based
    cell_a1 = gspread.utils.rowcol_to_a1(row, col_num)
    ws.update(range_name=cell_a1, values=[[valor]], value_input_option="USER_ENTERED")
    _cache["bets"] = None


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
    raw_rows = ws.get_all_values(value_render_option=gspread.utils.ValueRenderOption.unformatted)
    return _parse_bets_from_rows(rows, mes, raw_rows)


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


def delete_bet(mes, row):
    """"Exclui" uma aposta limpando os campos editáveis da linha (Data até
    Odd) — deixa a linha em branco, sem apagar a linha de verdade, pra não
    bagunçar as fórmulas nem a numeração das linhas abaixo."""
    client = _get_client()
    sheet_id = os.environ["SHEET_ID"]
    sh = client.open_by_key(sheet_id)
    ws = sh.worksheet(mes)

    rows = ws.get_all_values()
    _, data_col = _find_table_start(rows)
    if data_col is None:
        raise RuntimeError(f"Não encontrei a tabela de apostas na aba '{mes}'.")

    primeiro_col = data_col + 1  # Data (1-based)
    ultimo_col = data_col + len(EDITABLE_FIELDS)  # até Odd
    start_a1 = gspread.utils.rowcol_to_a1(row, primeiro_col)
    end_a1 = gspread.utils.rowcol_to_a1(row, ultimo_col)
    linha_em_branco = [[""] * (ultimo_col - primeiro_col + 1)]
    ws.update(range_name=f"{start_a1}:{end_a1}", values=linha_em_branco, value_input_option="USER_ENTERED")

    _cache["bets"] = None


def add_bet(mes, fields):
    """Adiciona uma aposta nova na aba `mes`, na primeira linha vazia depois
    da última aposta existente.

    Só preenche os campos até Odd (Data, Casa, Tipster, Aposta, Tipo,
    Mercado, Resultado, Stake, Odd) numa tacada só — as colunas de fórmula
    (Aposta R$, Lucro, Uni, Bank, Cresc%) devem já estar prontas na planilha
    (copiadas pra baixo com antecedência), do mesmo jeito que o bot do
    Telegram também só preenche até a Odd. "horario", se vier preenchido,
    é escrito à parte (mora no fim da tabela, depois das colunas de fórmula).

    `fields` é um dict com as chaves: data, horario, casa, tipster, aposta,
    tipo, mercado, resultado, stake, odd.
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

    # "horario" não é vizinho de Data..Odd (mora no fim da tabela, depois das
    # colunas de fórmula), então escreve numa célula separada.
    if fields.get("horario"):
        col_horario = data_col + COLUMNS.index("horario") + 1  # 1-based
        cell_a1 = gspread.utils.rowcol_to_a1(next_row, col_horario)
        ws.update(range_name=cell_a1, values=[[fields["horario"]]], value_input_option="USER_ENTERED")

    _cache["bets"] = None
    return next_row
