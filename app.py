import os
from functools import wraps
from flask import Flask, render_template, request, redirect, url_for, session, jsonify

from sheets import fetch_bets

app = Flask(__name__)
app.secret_key = os.environ.get("FLASK_SECRET_KEY", "troque-essa-chave-em-producao")

DASHBOARD_PASSWORD = os.environ.get("DASHBOARD_PASSWORD", "")


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
    return render_template("dashboard.html")


@app.route("/api/bets")
@login_required
def api_bets():
    try:
        bets = fetch_bets()
        return jsonify({"ok": True, "bets": bets})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


if __name__ == "__main__":
    app.run(debug=True, port=5000)
