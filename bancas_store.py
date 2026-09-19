"""Bancas cadastradas manualmente no dashboard, por mês e por casa.

Guardadas fora da planilha, num arquivo JSON local (data/bancas.json).
Estrutura: { "Setembro/2026": { "Bet365": {banca_inicial, banca_atual, saques}, ... } }

Cálculos:
  banca_rodando = banca_atual - saques
  lucro         = banca_atual + saques - banca_inicial
"""

import json
import os
import threading

_LOCK = threading.Lock()
_PATH = os.environ.get(
    "BANCAS_STORE_PATH",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "bancas.json"),
)


def _read():
    if not os.path.exists(_PATH):
        return {}
    with open(_PATH, "r", encoding="utf-8") as f:
        try:
            return json.load(f)
        except json.JSONDecodeError:
            return {}


def _write(data):
    os.makedirs(os.path.dirname(_PATH), exist_ok=True)
    tmp = _PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, _PATH)


def _to_float(v):
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def _calc(casa, valores):
    banca_inicial = _to_float(valores.get("banca_inicial"))
    banca_atual = _to_float(valores.get("banca_atual"))
    saques = _to_float(valores.get("saques"))
    return {
        "casa": casa,
        "banca_inicial": banca_inicial,
        "banca_atual": banca_atual,
        "saques": saques,
        "banca_rodando": banca_atual - saques,
        "lucro": banca_atual + saques - banca_inicial,
    }


def listar_bancas_mes(mes):
    """Todas as bancas cadastradas manualmente para o mês indicado."""
    with _LOCK:
        data = _read()
        mes_data = data.get(mes, {})
        linhas = [_calc(casa, valores) for casa, valores in mes_data.items()]
        linhas.sort(key=lambda l: l["casa"].lower())
        return linhas


def salvar_banca(mes, casa, banca_inicial, banca_atual, saques):
    """Cria ou atualiza (upsert, por nome da casa) a banca desse mês."""
    with _LOCK:
        data = _read()
        data.setdefault(mes, {})
        data[mes][casa] = {
            "banca_inicial": _to_float(banca_inicial),
            "banca_atual": _to_float(banca_atual),
            "saques": _to_float(saques),
        }
        _write(data)
        return _calc(casa, data[mes][casa])


def remover_banca(mes, casa):
    with _LOCK:
        data = _read()
        if mes in data and casa in data[mes]:
            del data[mes][casa]
            if not data[mes]:
                del data[mes]
            _write(data)
            return True
        return False
