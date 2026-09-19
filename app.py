import os
import json
from functools import wraps
from flask import Flask, render_template, request, redirect, url_for, session, jsonify, Response
import requests

from sheets import fetch_bets, fetch_bets_for_mes, update_bet, add_bet, fetch_bancas_for_mes, update_banca, delete_bet, listar_tipsters, adicionar_tipster, atualizar_status_tipster, remover_tipster, listar_casas, adicionar_casa, remover_casa
from bancas_store import listar_bancas_mes, salvar_banca, remover_banca

app = Flask(__name__)
app.secret_key = os.environ.get("FLASK_SECRET_KEY", "troque-essa-chave-em-producao")

DASHBOARD_PASSWORD = os.environ.get("DASHBOARD_PASSWORD", "")
DASHBOARD_USERNAME = os.environ.get("DASHBOARD_USERNAME", "")

# URL pública do bot do Telegram (agora rodando como Web Service) e a chave
# secreta compartilhada com ele — usados pra mandar prints de "+ Nova aposta"
# direto pro mesmo processamento por IA que o bot já usa.
BOT_API_URL = os.environ.get("BOT_API_URL", "").rstrip("/")
BOT_API_KEY = os.environ.get("BOT_API_KEY", "")


def login_required(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        if not session.get("logged_in"):
            return redirect(url_for("login"))
        return f(*args, **kwargs)
    return wrapper


@app.route("/login", methods=["GET", "POST"])
def login():
    error = None
    if request.method == "POST":
        usuario = request.form.get("usuario", "")
        senha = request.form.get("senha", "")
        # se DASHBOARD_USERNAME ainda não foi configurado no Render, o login
        # continua funcionando só com a senha (não trava ninguém de fora
        # enquanto a variável nova não é criada)
        usuario_ok = (not DASHBOARD_USERNAME) or usuario == DASHBOARD_USERNAME
        senha_ok = bool(DASHBOARD_PASSWORD) and senha == DASHBOARD_PASSWORD
        if usuario_ok and senha_ok:
            session["logged_in"] = True
            return redirect(url_for("index"))
        error = "Usuário ou senha incorretos."
    return render_template("login.html", error=error)


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


@app.route("/")
@login_required
def index():
    stake_base = os.environ.get("STAKE_BASE", "1000")
    return render_template("dashboard.html", stake_base=stake_base)


@app.route("/api/bets")
@login_required
def api_bets():
    try:
        force = request.args.get("force") == "1"
        bets = fetch_bets(force=force)
        return jsonify({"ok": True, "bets": bets})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/bets_mes/<path:mes>")
@login_required
def api_bets_mes(mes):
    """Relê só a aba de um mês — usado pra atualizar rápido depois de marcar
    resultado ou editar uma aposta, sem reler a planilha inteira."""
    try:
        bets = fetch_bets_for_mes(mes)
        return jsonify({"ok": True, "bets": bets})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/resolve", methods=["POST"])
@login_required
def api_resolve():
    """Marca o resultado (Green/Red/Void) de uma aposta pendente."""
    try:
        payload = request.get_json(force=True)
        mes = payload["mes"]
        row = int(payload["row"])
        resultado = payload["resultado"]
        if resultado not in ("Green", "Red", "Void"):
            return jsonify({"ok": False, "error": "Resultado inválido"}), 400
        update_bet(mes, row, {"resultado": resultado})
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/update_bet", methods=["POST"])
@login_required
def api_update_bet():
    """Edita um ou mais campos de uma aposta já existente."""
    try:
        payload = request.get_json(force=True)
        mes = payload["mes"]
        row = int(payload["row"])
        updates = payload.get("updates", {})
        update_bet(mes, row, updates)
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/add_bet", methods=["POST"])
@login_required
def api_add_bet():
    """Cria uma aposta nova na aba (mês) indicada."""
    try:
        payload = request.get_json(force=True)
        mes = payload["mes"]
        fields = payload.get("fields", {})
        row = add_bet(mes, fields)
        return jsonify({"ok": True, "row": row})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/bancas/<path:mes>")
@login_required
def api_bancas(mes):
    """Banca somada por casa de apostas (só contas Ativas), dentro do mês indicado."""
    try:
        dados = fetch_bancas_for_mes(mes)
        return jsonify({"ok": True, "resumo": dados["resumo"], "contas": dados["contas"]})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/exportar_apostas")
@login_required
def api_exportar_apostas():
    """Baixa todas as apostas (todos os meses) num JSON — pensado pra dar
    pra importar depois na plataforma multiusuário dos amigos, que usa
    esses mesmos nomes de campo (ver models.py de lá)."""
    try:
        bets = fetch_bets(force=True)
        exportado = [
            {
                "mes": b["mes"],
                "data_iso": b["data_iso"],
                "horario": b["horario"],
                "casa": b["casa"],
                "tipster": b["tipster"],
                "aposta": b["aposta"],
                "mercado": b["mercado"],
                "tipo": b["tipo"],
                "odd": b["odd"],
                "stake": b["stake"],
                "stake_reais": b["stake_reais"],
                "resultado": b["resultado"],
                "lucro_uni": b["lucro_uni"],
                "lucro_reais": b["lucro_reais"],
            }
            for b in bets
        ]
        corpo = json.dumps(exportado, ensure_ascii=False, indent=2)
        return Response(
            corpo,
            mimetype="application/json",
            headers={"Content-Disposition": "attachment; filename=apostas-exportadas.json"},
        )
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/update_banca", methods=["POST"])
@login_required
def api_update_banca():
    """Edita o valor de 'Total Banca' de uma conta específica."""
    try:
        payload = request.get_json(force=True)
        mes = payload["mes"]
        row = int(payload["row"])
        valor = payload["valor"]
        update_banca(mes, row, valor)
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/bancas-manual/<path:mes>")
@login_required
def api_bancas_manual(mes):
    """Bancas cadastradas manualmente no dashboard (sem planilha) pro mês indicado."""
    try:
        return jsonify({"ok": True, "bancas": listar_bancas_mes(mes)})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/bancas-manual/<path:mes>", methods=["POST"])
@login_required
def api_bancas_manual_salvar(mes):
    """Cria ou atualiza (upsert por Casa) uma banca manual desse mês."""
    try:
        payload = request.get_json(force=True)
        casa = (payload.get("casa") or "").strip()
        if not casa:
            return jsonify({"ok": False, "error": "Informe a casa."}), 400
        linha = salvar_banca(
            mes,
            casa,
            payload.get("banca_inicial"),
            payload.get("banca_atual"),
            payload.get("saques"),
        )
        return jsonify({"ok": True, "banca": linha})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/bancas-manual/remover", methods=["POST"])
@login_required
def api_bancas_manual_remover():
    try:
        payload = request.get_json(force=True)
        mes = payload["mes"]
        casa = payload["casa"]
        ok = remover_banca(mes, casa)
        return jsonify({"ok": ok})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/delete_bet", methods=["POST"])
@login_required
def api_delete_bet():
    """Exclui (limpa) uma aposta lançada errada/duplicada."""
    try:
        payload = request.get_json(force=True)
        mes = payload["mes"]
        row = int(payload["row"])
        delete_bet(mes, row)
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/add_bet_from_image", methods=["POST"])
@login_required
def api_add_bet_from_image():
    """Manda um print de aposta pro bot processar (mesma IA que o bot do
    Telegram usa) e escrever direto na planilha."""
    if not BOT_API_URL or not BOT_API_KEY:
        return jsonify({"status": "error", "message": "O dashboard ainda não está configurado pra falar com o bot (faltam BOT_API_URL/BOT_API_KEY)."}), 500

    if "image" not in request.files:
        return jsonify({"status": "error", "message": "Nenhuma imagem enviada."}), 400

    image_file = request.files["image"]
    mes = request.form.get("mes", "")
    caption = request.form.get("caption", "")
    data_aposta = request.form.get("data", "")

    try:
        resp = requests.post(
            f"{BOT_API_URL}/internal/process_screenshot",
            headers={"X-Internal-Key": BOT_API_KEY},
            files={"image": (image_file.filename, image_file.stream, image_file.mimetype)},
            data={"mes": mes, "caption": caption, "data": data_aposta},
            timeout=90,
        )
        return jsonify(resp.json()), resp.status_code
    except requests.RequestException as e:
        return jsonify({"status": "error", "message": f"Não consegui falar com o bot: {e}"}), 502


@app.route("/api/resolve_casa_image", methods=["POST"])
@login_required
def api_resolve_casa_image():
    """Confirma qual casa é (quando o bot pergunta, por causa de layout
    ambíguo entre duas casas) e finaliza o registro da aposta."""
    if not BOT_API_URL or not BOT_API_KEY:
        return jsonify({"status": "error", "message": "O dashboard ainda não está configurado pra falar com o bot."}), 500

    payload = request.get_json(force=True)
    try:
        resp = requests.post(
            f"{BOT_API_URL}/internal/resolve_casa",
            headers={"X-Internal-Key": BOT_API_KEY},
            json=payload,
            timeout=30,
        )
        return jsonify(resp.json()), resp.status_code
    except requests.RequestException as e:
        return jsonify({"status": "error", "message": f"Não consegui falar com o bot: {e}"}), 502


@app.route("/api/tipsters", methods=["GET"])
@login_required
def api_listar_tipsters():
    try:
        return jsonify({"ok": True, "tipsters": listar_tipsters()})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/tipsters", methods=["POST"])
@login_required
def api_adicionar_tipster():
    try:
        payload = request.get_json(force=True)
        adicionar_tipster(payload.get("nome", ""), payload.get("tipo", ""))
        return jsonify({"ok": True})
    except ValueError as e:
        return jsonify({"ok": False, "error": str(e)}), 400
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/tipsters/status", methods=["POST"])
@login_required
def api_status_tipster():
    try:
        payload = request.get_json(force=True)
        atualizar_status_tipster(payload.get("nome", ""), payload.get("status", ""))
        return jsonify({"ok": True})
    except ValueError as e:
        return jsonify({"ok": False, "error": str(e)}), 400
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/tipsters/remover", methods=["POST"])
@login_required
def api_remover_tipster():
    try:
        payload = request.get_json(force=True)
        remover_tipster(payload.get("nome", ""))
        return jsonify({"ok": True})
    except ValueError as e:
        return jsonify({"ok": False, "error": str(e)}), 400
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/casas", methods=["GET"])
@login_required
def api_listar_casas():
    try:
        return jsonify({"ok": True, "casas": listar_casas()})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/casas", methods=["POST"])
@login_required
def api_adicionar_casa():
    try:
        payload = request.get_json(force=True)
        adicionar_casa(payload.get("nome", ""))
        return jsonify({"ok": True})
    except ValueError as e:
        return jsonify({"ok": False, "error": str(e)}), 400
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/casas/remover", methods=["POST"])
@login_required
def api_remover_casa():
    try:
        payload = request.get_json(force=True)
        remover_casa(payload.get("nome", ""))
        return jsonify({"ok": True})
    except ValueError as e:
        return jsonify({"ok": False, "error": str(e)}), 400
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


if __name__ == "__main__":
    app.run(debug=True, port=5000)
