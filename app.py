import os
from functools import wraps
from flask import Flask, render_template, request, redirect, url_for, session, jsonify
import requests

from sheets import fetch_bets, fetch_bets_for_mes, update_bet, add_bet, fetch_bancas_for_mes, update_banca, delete_bet

app = Flask(__name__)
app.secret_key = os.environ.get("FLASK_SECRET_KEY", "troque-essa-chave-em-producao")

DASHBOARD_PASSWORD = os.environ.get("DASHBOARD_PASSWORD", "")

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
        senha = request.form.get("senha", "")
        if DASHBOARD_PASSWORD and senha == DASHBOARD_PASSWORD:
            session["logged_in"] = True
            return redirect(url_for("index"))
        error = "Senha incorreta."
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


if __name__ == "__main__":
    app.run(debug=True, port=5000)
