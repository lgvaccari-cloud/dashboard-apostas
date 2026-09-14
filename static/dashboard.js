const USER_NAME = "Luís Vaccari";
const MESES_PT = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

const ICON_MOON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
const ICON_SUN = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>`;
const ICON_TREND_UP = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l6-6 4 4 8-8"/><path d="M17 7h4v4"/></svg>`;
const ICON_TREND_DOWN = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7l6 6 4-4 8 8"/><path d="M17 17h4v-4"/></svg>`;
const ICON_TARGET = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1" fill="currentColor"/></svg>`;

let ALL_BETS = [];
let ACTIVE_TIPSTER = null;
let ACTIVE_MES = null;
let ONLY_PENDING = false;
let ONLY_TODAY = false;
let ONLY_YESTERDAY = false;
let ONLY_FUTURE = false;
let RANK_ONLY_TODAY = false;
let RANK_ONLY_YESTERDAY = false;
let AUTO_MES_APPLIED = false;
let chartInstance = null;
let CURRENT_VIEW = "geral";
let SHOW_BRL = false;
let EDITING_IDX = null;
let CURRENT_HISTORICO_BETS = [];

const RESOLVED_RESULTS = ["green", "red", "void"];

function esc(value) {
  return String(value ?? "").replace(/"/g, "&quot;");
}

function formatMesLabel(mes) {
  if (!mes) return mes;
  return mes.charAt(0).toUpperCase() + mes.slice(1).toLowerCase();
}

function todayISO() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function yesterdayISO() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function escJs(value) {
  return String(value ?? "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function getRoiPctFromSheet(mes) {
  const bet = ALL_BETS.find(b => b.mes === mes && b.mes_roi_pct);
  return bet ? bet.mes_roi_pct : null;
}

function fmtUnits(n, sign) {
  const s = n.toFixed(2).replace(".", ",");
  if (sign && n > 0) return `+${s}u`;
  return `${s}u`;
}

function fmtBRL(n, sign) {
  const s = Math.abs(n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const signChar = sign && n > 0 ? "+" : (n < 0 ? "-" : "");
  return `${signChar}R$ ${s}`;
}

// dual: recebe o valor em unidades e o valor real em reais (já exato, vindo da
// planilha) e escolhe qual mostrar conforme o modo atual
function fmtDual(nUni, nReais, sign) {
  if (SHOW_BRL) return fmtBRL(nReais, sign);
  return fmtUnits(nUni, sign);
}

function fmtPct(n) {
  const s = n.toFixed(1).replace(".", ",");
  return `${n > 0 ? "+" : ""}${s}%`;
}

function isResolved(bet) {
  return RESOLVED_RESULTS.includes((bet.resultado || "").toLowerCase());
}

function setToday() {
  const now = new Date();
  const label = now.toLocaleDateString("pt-BR", {
    weekday: "long", day: "2-digit", month: "long",
  });
  document.getElementById("today-label").textContent = label.toUpperCase();

  const hour = now.getHours();
  const saud = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
  document.getElementById("greeting").textContent = `${saud}, ${USER_NAME}.`;
}

function updateDailySubtitle() {
  const hoje = todayISO();
  const betsHoje = ALL_BETS.filter(b => b.data_iso === hoje && isResolved(b));
  const el = document.getElementById("subtitle");
  if (!betsHoje.length) {
    el.textContent = "Nenhuma aposta resolvida hoje ainda.";
    return;
  }
  const somaUni = betsHoje.reduce((s, b) => s + b.lucro_uni, 0);
  const somaReais = betsHoje.reduce((s, b) => s + b.lucro_reais, 0);
  const valorRef = SHOW_BRL ? somaReais : somaUni;
  const cor = valorRef >= 0 ? "var(--green)" : "var(--red)";
  el.innerHTML = `Você está <b style="color:${cor}">${fmtDual(somaUni, somaReais, true)}</b> no dia`;
}

// ---------- Modo noturno ----------
function setDarkMode(on) {
  document.body.classList.toggle("dark-mode", on);
  document.getElementById("toggle-dark").innerHTML = on ? ICON_SUN : ICON_MOON;
  try { localStorage.setItem("painel_dark_mode", on ? "1" : "0"); } catch (e) {}
  if (ALL_BETS.length) renderAll(); // recria o gráfico com as cores certas
}

document.getElementById("toggle-dark").addEventListener("click", () => {
  setDarkMode(!document.body.classList.contains("dark-mode"));
});

// ---------- Unidades / Reais ----------
function setCurrency(showBRL) {
  SHOW_BRL = showBRL;
  document.getElementById("toggle-uni").classList.toggle("active", !showBRL);
  document.getElementById("toggle-real").classList.toggle("active", showBRL);
  renderAll();
}

document.getElementById("toggle-uni").addEventListener("click", () => setCurrency(false));
document.getElementById("toggle-real").addEventListener("click", () => setCurrency(true));

// ---------- Carregar dados ----------
async function loadData(force) {
  const errorBox = document.getElementById("error-box");
  errorBox.style.display = "none";
  try {
    const res = await fetch(force ? "/api/bets?force=1" : "/api/bets");
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Erro desconhecido");
    ALL_BETS = data.bets;
    EDITING_IDX = null;
    tryAutoSelectMonth();
    renderMesChips();
    renderChips();
    populateNewBetMesOptions();
    renderAll();
  } catch (err) {
    errorBox.style.display = "block";
    errorBox.textContent = "Não consegui carregar os dados da planilha: " + err.message;
  }
}

async function refreshMes(mes) {
  try {
    const res = await fetch(`/api/bets_mes/${encodeURIComponent(mes)}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Erro ao atualizar");
    ALL_BETS = ALL_BETS.filter(b => b.mes !== mes).concat(data.bets);
    renderAll();
  } catch (err) {
    console.error("Falha ao atualizar o mês:", err);
  }
}

function tryAutoSelectMonth() {
  if (AUTO_MES_APPLIED) return;
  AUTO_MES_APPLIED = true;
  const nomeAtual = MESES_PT[new Date().getMonth()];
  const meses = [...new Set(ALL_BETS.map(b => b.mes).filter(Boolean))];
  const encontrado = meses.find(m => m.toLowerCase().includes(nomeAtual));
  if (encontrado) ACTIVE_MES = encontrado;
}

// ---------- Chips de tipster (só aparecem com um mês selecionado) ----------
function renderChips() {
  const bar = document.getElementById("tipster-filter-bar");
  if (!ACTIVE_MES || CURRENT_VIEW === "ranking" || CURRENT_VIEW === "bancas") {
    bar.style.display = "none";
    return;
  }
  bar.style.display = "";

  const betsDoMes = ALL_BETS.filter(b => b.mes === ACTIVE_MES);
  const tipsters = [...new Set(betsDoMes.map(b => b.tipster).filter(Boolean))].sort();
  const container = document.getElementById("tipster-chips");
  container.innerHTML = "";
  tipsters.forEach(t => {
    const chip = document.createElement("button");
    chip.className = "chip" + (ACTIVE_TIPSTER === t ? " active" : "");
    chip.textContent = t;
    chip.onclick = () => {
      ACTIVE_TIPSTER = (ACTIVE_TIPSTER === t) ? null : t;
      renderChips();
      renderAll();
    };
    container.appendChild(chip);
  });
  document.getElementById("clear-filters").style.display = ACTIVE_TIPSTER ? "inline" : "none";

  const select = document.getElementById("tipster-select");
  select.innerHTML = `<option value="">Todos os tipsters</option>` +
    tipsters.map(t => `<option value="${esc(t)}" ${ACTIVE_TIPSTER === t ? "selected" : ""}>${esc(t)}</option>`).join("");
}

document.getElementById("tipster-select").addEventListener("change", (e) => {
  ACTIVE_TIPSTER = e.target.value || null;
  renderChips();
  renderAll();
});

document.getElementById("clear-filters").addEventListener("click", () => {
  ACTIVE_TIPSTER = null;
  renderChips();
  renderAll();
});

// ---------- Chips de mês ----------
function renderMesChips() {
  // mantém a ordem em que os meses aparecem na planilha (ordem das abas)
  const meses = [...new Set(ALL_BETS.map(b => b.mes).filter(Boolean))];
  const container = document.getElementById("mes-chips");
  container.innerHTML = "";
  meses.forEach(m => {
    const chip = document.createElement("button");
    chip.className = "chip" + (ACTIVE_MES === m ? " active" : "");
    chip.textContent = formatMesLabel(m);
    chip.onclick = () => {
      ACTIVE_MES = (ACTIVE_MES === m) ? null : m;
      ACTIVE_TIPSTER = null; // a lista de tipsters muda de mês pra mês
      renderMesChips();
      renderChips();
      renderAll();
    };
    container.appendChild(chip);
  });
  document.getElementById("clear-mes").style.display = ACTIVE_MES ? "inline" : "none";

  const select = document.getElementById("mes-select");
  select.innerHTML = `<option value="">Todos os meses</option>` +
    meses.map(m => `<option value="${esc(m)}" ${ACTIVE_MES === m ? "selected" : ""}>${esc(formatMesLabel(m))}</option>`).join("");
}

document.getElementById("mes-select").addEventListener("change", (e) => {
  ACTIVE_MES = e.target.value || null;
  ACTIVE_TIPSTER = null;
  renderMesChips();
  renderChips();
  renderAll();
});

document.getElementById("clear-mes").addEventListener("click", () => {
  ACTIVE_MES = null;
  ACTIVE_TIPSTER = null;
  renderMesChips();
  renderChips();
  renderAll();
});

// ---------- Barra "Filtros ativos" ----------
function renderActiveFiltersBar() {
  const bar = document.getElementById("active-filters-bar");
  const container = document.getElementById("active-filter-chips");
  const filtros = [];
  if (ACTIVE_MES) filtros.push({ label: `Mês: ${formatMesLabel(ACTIVE_MES)}`, clear: () => { ACTIVE_MES = null; ACTIVE_TIPSTER = null; } });
  if (ACTIVE_TIPSTER) filtros.push({ label: `Tipster: ${ACTIVE_TIPSTER}`, clear: () => { ACTIVE_TIPSTER = null; } });

  if (!filtros.length) {
    bar.style.display = "none";
    return;
  }
  bar.style.display = "flex";
  container.innerHTML = "";
  filtros.forEach(f => {
    const chip = document.createElement("span");
    chip.className = "active-chip";
    chip.innerHTML = `${f.label} <button type="button">✕</button>`;
    chip.querySelector("button").onclick = () => {
      f.clear();
      renderMesChips();
      renderChips();
      renderActiveFiltersBar();
      renderAll();
    };
    container.appendChild(chip);
  });
}

document.getElementById("clear-all-filters").addEventListener("click", () => {
  ACTIVE_MES = null;
  ACTIVE_TIPSTER = null;
  renderMesChips();
  renderChips();
  renderAll();
});

// ---------- Navegação entre visões ----------
function switchView(view) {
  CURRENT_VIEW = view;
  ["geral", "historico", "ranking", "bancas"].forEach(v => {
    document.getElementById(`view-${v}`).style.display = (v === view) ? "" : "none";
  });
  document.getElementById("nav-geral").classList.toggle("active", view === "geral");
  document.getElementById("nav-historico").classList.toggle("active", view === "historico");
  document.getElementById("nav-ranking").classList.toggle("active", view === "ranking");
  document.getElementById("nav-bancas").classList.toggle("active", view === "bancas");

  renderChips();

  if (view === "historico") renderHistorico();
  if (view === "ranking") renderRanking();
  if (view === "bancas") loadBancas();
}

document.getElementById("nav-geral").addEventListener("click", () => switchView("geral"));
document.getElementById("brand-home").addEventListener("click", () => switchView("geral"));
document.getElementById("nav-historico").addEventListener("click", () => {
  ONLY_PENDING = false;
  switchView("historico");
});
document.getElementById("nav-ranking").addEventListener("click", () => switchView("ranking"));
document.getElementById("nav-bancas").addEventListener("click", () => switchView("bancas"));

document.getElementById("card-aberto").addEventListener("click", () => {
  ONLY_PENDING = true;
  EDITING_IDX = null;
  switchView("historico");
});

document.getElementById("clear-pending-filter").addEventListener("click", () => {
  ONLY_PENDING = false;
  renderHistorico();
});

document.getElementById("filter-today").addEventListener("click", () => {
  ONLY_TODAY = !ONLY_TODAY;
  if (ONLY_TODAY) { ONLY_YESTERDAY = false; ONLY_FUTURE = false; }
  document.getElementById("filter-today").classList.toggle("active", ONLY_TODAY);
  document.getElementById("filter-yesterday").classList.remove("active");
  document.getElementById("filter-future").classList.remove("active");
  renderHistorico();
});

document.getElementById("filter-yesterday").addEventListener("click", () => {
  ONLY_YESTERDAY = !ONLY_YESTERDAY;
  if (ONLY_YESTERDAY) { ONLY_TODAY = false; ONLY_FUTURE = false; }
  document.getElementById("filter-yesterday").classList.toggle("active", ONLY_YESTERDAY);
  document.getElementById("filter-today").classList.remove("active");
  document.getElementById("filter-future").classList.remove("active");
  renderHistorico();
});

document.getElementById("filter-future").addEventListener("click", () => {
  ONLY_FUTURE = !ONLY_FUTURE;
  if (ONLY_FUTURE) { ONLY_TODAY = false; ONLY_YESTERDAY = false; }
  document.getElementById("filter-future").classList.toggle("active", ONLY_FUTURE);
  document.getElementById("filter-today").classList.remove("active");
  document.getElementById("filter-yesterday").classList.remove("active");
  renderHistorico();
});

document.getElementById("rank-filter-today").addEventListener("click", () => {
  RANK_ONLY_TODAY = !RANK_ONLY_TODAY;
  if (RANK_ONLY_TODAY) RANK_ONLY_YESTERDAY = false;
  document.getElementById("rank-filter-today").classList.toggle("active", RANK_ONLY_TODAY);
  document.getElementById("rank-filter-yesterday").classList.remove("active");
  renderRanking();
});

document.getElementById("rank-filter-yesterday").addEventListener("click", () => {
  RANK_ONLY_YESTERDAY = !RANK_ONLY_YESTERDAY;
  if (RANK_ONLY_YESTERDAY) RANK_ONLY_TODAY = false;
  document.getElementById("rank-filter-yesterday").classList.toggle("active", RANK_ONLY_YESTERDAY);
  document.getElementById("rank-filter-today").classList.remove("active");
  renderRanking();
});

const SORT_STATE = {
  hist: { key: null, dir: 1 },
  rank: { key: null, dir: 1 },
  banca: { key: null, dir: 1 },
};

function applySort(list, state, getter) {
  if (!state.key) return list;
  return list.slice().sort((a, b) => {
    let va = getter(a, state.key);
    let vb = getter(b, state.key);
    if (va == null) va = "";
    if (vb == null) vb = "";
    if (typeof va === "string") va = va.toLowerCase();
    if (typeof vb === "string") vb = vb.toLowerCase();
    if (va < vb) return -1 * state.dir;
    if (va > vb) return 1 * state.dir;
    return 0;
  });
}

const HIST_HEADERS = [
  ["th-hist-data", "data_iso"],
  ["th-hist-casa", "casa"],
  ["th-hist-tipster", "tipster"],
  ["th-hist-aposta", "aposta"],
  ["th-hist-odd", "odd"],
  ["th-hist-stake", "stake"],
  ["th-hist-resultado", "resultado"],
  ["th-hist-uni", "lucro_uni"],
];
const RANK_HEADERS = [
  ["th-rank-tipster", "tipster"],
  ["th-rank-apostas", "apostas"],
  ["th-rank-taxa", "taxa"],
  ["th-rank-roi", "roi"],
  ["th-rank-resultado", "lucro"],
];
const BANCA_HEADERS = [
  ["th-banca-casa", "casa"],
  ["th-banca-contas", "contas"],
  ["th-banca-total", "banca"],
];

function setupSortableHeaders(headers, stateKey, rerenderFn) {
  headers.forEach(([id, field]) => {
    const th = document.getElementById(id);
    if (!th) return;
    const label = th.textContent;
    th.classList.add("sortable");
    th.innerHTML = `<span class="th-text">${label}</span><span class="sort-arrow" id="arrow-${id}"></span>`;
    th.addEventListener("click", () => {
      const state = SORT_STATE[stateKey];
      if (state.key === field) state.dir *= -1;
      else { state.key = field; state.dir = 1; }
      headers.forEach(([hid]) => {
        const arrowEl = document.getElementById(`arrow-${hid}`);
        if (arrowEl) arrowEl.textContent = "";
      });
      const activeArrow = document.getElementById(`arrow-${id}`);
      if (activeArrow) activeArrow.textContent = state.dir === 1 ? "▲" : "▼";
      rerenderFn();
    });
  });
}

function resultTag(resultado) {
  const r = (resultado || "").toLowerCase();
  if (r === "green") return `<span class="result-tag green">✓</span>`;
  if (r === "red") return `<span class="result-tag red">✕</span>`;
  if (r === "void") return `<span class="result-tag void">–</span>`;
  return `<span class="result-tag pending">•</span>`;
}

// ---------- Marcar resultado (Green/Red/Void) ----------
async function resolveBetByIndex(idx, resultado) {
  const bet = CURRENT_HISTORICO_BETS[idx];
  if (!bet) return;

  const resultadoAnterior = bet.resultado;
  bet.resultado = resultado;
  renderHistorico();

  try {
    const res = await fetch("/api/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mes: bet.mes, row: bet.row, resultado }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Erro ao marcar resultado");
    setTimeout(() => refreshMes(bet.mes), 900);
  } catch (err) {
    bet.resultado = resultadoAnterior;
    renderHistorico();
    alert("Não consegui marcar o resultado: " + err.message);
  }
}

// ---------- Editar uma aposta ----------
function startEdit(idx) {
  EDITING_IDX = idx;
  renderHistorico();
}

function cancelEdit() {
  EDITING_IDX = null;
  renderHistorico();
}

async function saveEdit(idx) {
  const bet = CURRENT_HISTORICO_BETS[idx];
  if (!bet) return;
  const updates = {
    data: document.getElementById(`edit-data-${idx}`).value,
    casa: document.getElementById(`edit-casa-${idx}`).value,
    tipster: document.getElementById(`edit-tipster-${idx}`).value,
    aposta: document.getElementById(`edit-aposta-${idx}`).value,
    odd: document.getElementById(`edit-odd-${idx}`).value,
    stake: document.getElementById(`edit-stake-${idx}`).value,
    resultado: document.getElementById(`edit-resultado-${idx}`).value,
  };

  const anterior = { ...bet };
  bet.casa = updates.casa;
  bet.tipster = updates.tipster;
  bet.aposta = updates.aposta;
  bet.resultado = updates.resultado;
  bet.data = updates.data;
  EDITING_IDX = null;
  renderHistorico();

  try {
    const res = await fetch("/api/update_bet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mes: bet.mes, row: bet.row, updates }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Erro ao salvar");
    setTimeout(() => refreshMes(bet.mes), 900);
  } catch (err) {
    Object.assign(bet, anterior);
    renderHistorico();
    alert("Não consegui salvar: " + err.message);
  }
}

// ---------- Tabela de histórico ----------
function renderHistorico() {
  const tbody = document.getElementById("bets-table-body");
  if (!tbody) return;

  let bets = historicoBets().slice();
  if (SORT_STATE.hist.key) {
    bets = applySort(bets, SORT_STATE.hist, (b, k) => b[k]);
  } else {
    bets.sort((a, b) => (b.data_iso || "").localeCompare(a.data_iso || ""));
  }

  CURRENT_HISTORICO_BETS = bets;

  document.getElementById("pending-banner").style.display = ONLY_PENDING ? "flex" : "none";

  tbody.innerHTML = bets.map((b, idx) => {
    const uniClass = b.lucro_uni > 0 ? "positive" : b.lucro_uni < 0 ? "negative" : "";
    const editing = EDITING_IDX === idx;

    if (editing) {
      return `
        <tr>
          <td><input class="edit-input small" id="edit-data-${idx}" value="${esc(b.data)}"></td>
          <td><input class="edit-input" id="edit-casa-${idx}" value="${esc(b.casa)}"></td>
          <td><input class="edit-input" id="edit-tipster-${idx}" value="${esc(b.tipster)}"></td>
          <td><input class="edit-input" id="edit-aposta-${idx}" value="${esc(b.aposta)}"></td>
          <td><input class="edit-input small" id="edit-odd-${idx}" value="${esc(b.odd ? b.odd.toFixed(3).replace(".", ",") : "")}"></td>
          <td><input class="edit-input small" id="edit-stake-${idx}" value="${esc(b.stake ? b.stake.toFixed(4).replace(".", ",") : "")}"></td>
          <td>
            <select class="edit-input" id="edit-resultado-${idx}">
              <option value="" ${!b.resultado ? "selected" : ""}>Pendente</option>
              <option value="Green" ${b.resultado === "Green" ? "selected" : ""}>Green</option>
              <option value="Red" ${b.resultado === "Red" ? "selected" : ""}>Red</option>
              <option value="Void" ${b.resultado === "Void" ? "selected" : ""}>Void</option>
            </select>
          </td>
          <td>—</td>
          <td>
            <div class="row-actions">
              <button class="row-action-btn save" title="Salvar" onclick="saveEdit(${idx})">✓</button>
              <button class="row-action-btn cancel" title="Cancelar" onclick="cancelEdit()">✕</button>
            </div>
          </td>
        </tr>
      `;
    }

    const resolvedCell = isResolved(b)
      ? resultTag(b.resultado)
      : `<div class="resolve-actions">
           <button class="resolve-btn green" title="Green" onclick="resolveBetByIndex(${idx}, 'Green')">✓</button>
           <button class="resolve-btn red" title="Red" onclick="resolveBetByIndex(${idx}, 'Red')">✕</button>
           <button class="resolve-btn void" title="Void" onclick="resolveBetByIndex(${idx}, 'Void')">–</button>
         </div>`;

    return `
      <tr>
        <td>${b.data || "—"}</td>
        <td>${b.casa || "—"}</td>
        <td>${b.tipster || "—"}</td>
        <td>${b.aposta || "—"}</td>
        <td>${b.odd ? b.odd.toFixed(3).replace(".", ",") : "—"}</td>
        <td>${b.stake ? fmtDual(b.stake, b.stake_reais, false) : "—"}</td>
        <td>${resolvedCell}</td>
        <td class="uni-cell ${uniClass}">${isResolved(b) ? fmtDual(b.lucro_uni, b.lucro_reais, true) : "—"}</td>
        <td><button class="row-action-btn" title="Editar" onclick="startEdit(${idx})">✎</button></td>
      </tr>
    `;
  }).join("");
}

function currentBets() {
  let result = ALL_BETS;
  if (ACTIVE_TIPSTER) result = result.filter(b => b.tipster === ACTIVE_TIPSTER);
  if (ACTIVE_MES) result = result.filter(b => b.mes === ACTIVE_MES);
  return result;
}

// usado só na tabela do Histórico — soma os filtros rápidos (pendentes,
// hoje, ontem) por cima do filtro de tipster/mês, sem afetar os cards/gráfico
function historicoBets() {
  let result = currentBets();
  if (ONLY_PENDING) result = result.filter(b => !isResolved(b));
  if (ONLY_TODAY) result = result.filter(b => b.data_iso === todayISO());
  if (ONLY_YESTERDAY) result = result.filter(b => b.data_iso === yesterdayISO());
  if (ONLY_FUTURE) result = result.filter(b => !isResolved(b) && b.data_iso && b.data_iso > todayISO());
  return result;
}

// ---------- Modal "Nova aposta" ----------
function populateNewBetMesOptions() {
  const select = document.getElementById("new-bet-mes");
  const meses = [...new Set(ALL_BETS.map(b => b.mes).filter(Boolean))];
  const atual = select.value;
  select.innerHTML = meses.map(m => `<option value="${esc(m)}">${esc(formatMesLabel(m))}</option>`).join("");
  if (ACTIVE_MES && meses.includes(ACTIVE_MES)) {
    select.value = ACTIVE_MES;
  } else if (meses.includes(atual)) {
    select.value = atual;
  }
}

function openNewBetModal() {
  populateNewBetMesOptions();
  const hoje = new Date();
  const dd = String(hoje.getDate()).padStart(2, "0");
  const mm = String(hoje.getMonth() + 1).padStart(2, "0");
  document.getElementById("new-bet-data").value = `${dd}/${mm}/${hoje.getFullYear()}`;
  document.getElementById("new-bet-casa").value = "";
  document.getElementById("new-bet-tipster").value = "";
  document.getElementById("new-bet-aposta").value = "";
  document.getElementById("new-bet-mercado").value = "";
  document.getElementById("new-bet-tipo").value = "";
  document.getElementById("new-bet-odd").value = "";
  document.getElementById("new-bet-stake").value = "";
  document.getElementById("new-bet-resultado").value = "";
  document.getElementById("new-bet-overlay").style.display = "flex";
}

function closeNewBetModal() {
  document.getElementById("new-bet-overlay").style.display = "none";
}

document.getElementById("new-bet-btn").addEventListener("click", openNewBetModal);
document.getElementById("new-bet-cancel").addEventListener("click", closeNewBetModal);
document.getElementById("new-bet-overlay").addEventListener("click", (e) => {
  if (e.target.id === "new-bet-overlay") closeNewBetModal();
});

document.getElementById("new-bet-save").addEventListener("click", async () => {
  const mes = document.getElementById("new-bet-mes").value;
  const fields = {
    data: document.getElementById("new-bet-data").value,
    casa: document.getElementById("new-bet-casa").value,
    tipster: document.getElementById("new-bet-tipster").value,
    aposta: document.getElementById("new-bet-aposta").value,
    mercado: document.getElementById("new-bet-mercado").value,
    tipo: document.getElementById("new-bet-tipo").value,
    odd: document.getElementById("new-bet-odd").value,
    stake: document.getElementById("new-bet-stake").value,
    resultado: document.getElementById("new-bet-resultado").value,
  };
  if (!mes) { alert("Escolha um mês."); return; }
  if (!fields.casa || !fields.tipster) { alert("Preencha ao menos Casa e Tipster."); return; }

  try {
    const res = await fetch("/api/add_bet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mes, fields }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Erro ao salvar");
    closeNewBetModal();
    setTimeout(() => refreshMes(mes), 900);
  } catch (err) {
    alert("Não consegui salvar a aposta nova: " + err.message);
  }
});

// ---------- Ranking de tipsters ----------
function renderRanking() {
  const tbody = document.getElementById("ranking-table-body");
  if (!tbody) return;

  let bets = ACTIVE_MES ? ALL_BETS.filter(b => b.mes === ACTIVE_MES) : ALL_BETS;
  if (RANK_ONLY_TODAY) bets = bets.filter(b => b.data_iso === todayISO());
  if (RANK_ONLY_YESTERDAY) bets = bets.filter(b => b.data_iso === yesterdayISO());
  const porTipster = {};

  bets.forEach(b => {
    if (!b.tipster) return;
    if (!porTipster[b.tipster]) {
      porTipster[b.tipster] = { apostas: 0, greens: 0, reds: 0, stake: 0, stakeReais: 0, lucro: 0, lucroReais: 0 };
    }
    const t = porTipster[b.tipster];
    t.apostas += 1;
    if (isResolved(b)) {
      t.stake += b.stake;
      t.stakeReais += b.stake_reais;
      t.lucro += b.lucro_uni;
      t.lucroReais += b.lucro_reais;
      const r = (b.resultado || "").toLowerCase();
      if (r === "green") t.greens += 1;
      if (r === "red") t.reds += 1;
    }
  });

  const linhas = Object.entries(porTipster).map(([tipster, t]) => {
    const decisoes = t.greens + t.reds;
    const taxa = decisoes > 0 ? (t.greens / decisoes) * 100 : null;
    const roi = t.stake > 0 ? (t.lucro / t.stake) * 100 : null;
    return { tipster, ...t, taxa, roi };
  });
  const linhasOrdenadas = SORT_STATE.rank.key
    ? applySort(linhas, SORT_STATE.rank, (l, k) => l[k])
    : linhas.slice().sort((a, b) => b.lucro - a.lucro);

  if (!linhasOrdenadas.length) {
    tbody.innerHTML = `<tr><td colspan="5">Sem apostas nesse filtro ainda.</td></tr>`;
    return;
  }

  tbody.innerHTML = linhasOrdenadas.map(l => {
    const cls = l.lucro > 0 ? "positive" : l.lucro < 0 ? "negative" : "";
    return `
      <tr>
        <td>${l.tipster}</td>
        <td>${l.apostas}</td>
        <td>${l.taxa !== null ? l.taxa.toFixed(1).replace(".", ",") + "%" : "—"}</td>
        <td>${l.roi !== null ? fmtPct(l.roi) : "—"}</td>
        <td class="${cls}"><b>${fmtDual(l.lucro, l.lucroReais, true)}</b></td>
      </tr>
    `;
  }).join("");
}

// ---------- Bancas por casa ----------
let LAST_BANCAS_RESUMO = [];
let LAST_BANCAS_CONTAS = [];
let EXPANDED_CASA = null;

async function loadBancas() {
  const tbody = document.getElementById("bancas-table-body");
  if (!tbody) return;

  if (!ACTIVE_MES) {
    document.getElementById("banca-total").textContent = "—";
    document.getElementById("banca-total-foot").textContent = "Selecione um mês no filtro";
    tbody.innerHTML = `<tr><td colspan="3">Selecione um mês no filtro pra ver as bancas desse mês.</td></tr>`;
    return;
  }

  tbody.innerHTML = `<tr><td colspan="3">Carregando...</td></tr>`;
  try {
    const res = await fetch(`/api/bancas/${encodeURIComponent(ACTIVE_MES)}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Erro ao carregar bancas");
    LAST_BANCAS_RESUMO = data.resumo;
    LAST_BANCAS_CONTAS = data.contas;
    renderBancasTable();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="3">Erro: ${err.message}</td></tr>`;
  }
}

function renderBancasTable() {
  const tbody = document.getElementById("bancas-table-body");
  if (!tbody) return;

  const linhasOrdenadas = SORT_STATE.banca.key
    ? applySort(LAST_BANCAS_RESUMO, SORT_STATE.banca, (l, k) => l[k])
    : LAST_BANCAS_RESUMO.slice().sort((a, b) => b.banca - a.banca);

  const totalGeral = LAST_BANCAS_RESUMO.reduce((s, r) => s + r.banca, 0);
  document.getElementById("banca-total").textContent =
    totalGeral.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  document.getElementById("banca-total-foot").textContent =
    `${LAST_BANCAS_RESUMO.length} casa${LAST_BANCAS_RESUMO.length === 1 ? "" : "s"} ativa${LAST_BANCAS_RESUMO.length === 1 ? "" : "s"}`;

  if (!linhasOrdenadas.length) {
    tbody.innerHTML = `<tr><td colspan="3">Não encontrei a tabela de bancas nessa aba.</td></tr>`;
    return;
  }

  tbody.innerHTML = linhasOrdenadas.map(l => {
    const rowHtml = `
      <tr class="banca-casa-row" onclick="toggleBancaCasa('${escJs(l.casa)}')">
        <td>${l.casa}</td>
        <td>${l.contas} conta${l.contas === 1 ? "" : "s"} ativa${l.contas === 1 ? "" : "s"}</td>
        <td><b>${l.banca.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</b></td>
      </tr>
    `;
    if (EXPANDED_CASA !== l.casa) return rowHtml;

    const contasDaCasa = LAST_BANCAS_CONTAS.filter(c => c.casa === l.casa);
    const detailHtml = `
      <tr class="banca-detail-row">
        <td colspan="3">
          <div class="banca-detail-inner">
            ${contasDaCasa.map(c => `
              <div class="banca-conta-line">
                <span class="banca-conta-nome">${c.nome || "—"}</span>
                <input class="edit-input" id="banca-input-${c.row}" value="${esc(c.banca.toFixed(2).replace(".", ","))}">
                <button class="row-action-btn save" onclick="event.stopPropagation(); saveBancaConta(${c.row})">Salvar</button>
              </div>
            `).join("")}
          </div>
        </td>
      </tr>
    `;
    return rowHtml + detailHtml;
  }).join("");
}

function toggleBancaCasa(casa) {
  EXPANDED_CASA = (EXPANDED_CASA === casa) ? null : casa;
  renderBancasTable();
}

async function saveBancaConta(row) {
  const input = document.getElementById(`banca-input-${row}`);
  if (!input) return;
  try {
    const res = await fetch("/api/update_banca", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mes: ACTIVE_MES, row, valor: input.value }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Erro ao salvar");
    await loadBancas();
  } catch (err) {
    alert("Não consegui salvar: " + err.message);
  }
}

// ---------- Visão geral (cards + gráfico) ----------
function renderAll() {
  updateDailySubtitle();
  renderActiveFiltersBar();

  const bets = currentBets();
  const resolved = bets.filter(isResolved);
  const pending = bets.filter(b => !isResolved(b));

  const resultadoLiquido = resolved.reduce((s, b) => s + b.lucro_uni, 0);
  const resultadoLiquidoReais = resolved.reduce((s, b) => s + b.lucro_reais, 0);
  const volumeApostadoResolved = resolved.reduce((s, b) => s + b.stake, 0);
  const volumeApostadoResolvedReais = resolved.reduce((s, b) => s + b.stake_reais, 0);
  const roi = volumeApostadoResolved > 0 ? (resultadoLiquido / volumeApostadoResolved) * 100 : 0;

  const liquidoEl = document.getElementById("metric-liquido");
  liquidoEl.textContent = fmtDual(resultadoLiquido, resultadoLiquidoReais, true);
  liquidoEl.className = "card-value" + (resultadoLiquido > 0 ? " positive" : resultadoLiquido < 0 ? " negative" : "");
  document.getElementById("card-liquido-label").textContent = ACTIVE_MES ? "Total no mês" : "Total no ano";

  const roiDaPlanilha = ACTIVE_MES ? getRoiPctFromSheet(ACTIVE_MES) : null;
  document.getElementById("metric-liquido-foot").textContent = roiDaPlanilha
    ? `${roiDaPlanilha} de ROI`
    : `ROI sobre ${fmtDual(volumeApostadoResolved, volumeApostadoResolvedReais, false)} resolvido`;

  const emAberto = pending.reduce((s, b) => s + b.stake, 0);
  const emAbertoReais = pending.reduce((s, b) => s + b.stake_reais, 0);
  document.getElementById("metric-aberto").textContent = fmtDual(emAberto, emAbertoReais, false);
  document.getElementById("metric-aberto-foot").textContent = `${pending.length} pendentes`;

  document.getElementById("metric-volume").textContent = fmtDual(volumeApostadoResolved, volumeApostadoResolvedReais, false);
  document.getElementById("metric-volume-foot").textContent = `${resolved.length} resolvidas`;

  const ganhos = resolved.filter(b => b.lucro_uni > 0);
  const perdas = resolved.filter(b => b.lucro_uni < 0);
  const lucroBruto = ganhos.reduce((s, b) => s + b.lucro_uni, 0);
  const lucroBrutoReais = ganhos.reduce((s, b) => s + b.lucro_reais, 0);
  const prejuizoBruto = Math.abs(perdas.reduce((s, b) => s + b.lucro_uni, 0));
  const prejuizoBrutoReais = Math.abs(perdas.reduce((s, b) => s + b.lucro_reais, 0));

  document.getElementById("metric-lucro").textContent = fmtDual(lucroBruto, lucroBrutoReais, false);
  document.getElementById("metric-lucro-foot").textContent = `${ganhos.length} com lucro`;
  document.getElementById("metric-prejuizo").textContent = fmtDual(prejuizoBruto, prejuizoBrutoReais, false);
  document.getElementById("metric-prejuizo-foot").textContent = `${perdas.length} com prejuízo`;

  const greens = resolved.filter(b => (b.resultado || "").toLowerCase() === "green").length;
  const reds = resolved.filter(b => (b.resultado || "").toLowerCase() === "red").length;
  const decisoes = greens + reds;
  const taxaAcerto = decisoes > 0 ? (greens / decisoes) * 100 : 0;

  document.getElementById("metric-acerto").textContent = decisoes > 0 ? `${taxaAcerto.toFixed(1).replace(".", ",")}%` : "—";
  document.getElementById("acerto-bar").style.width = `${taxaAcerto}%`;
  document.getElementById("metric-acerto-foot").textContent = `${greens} positivas em ${decisoes} apostas`;

  const roiPill = document.getElementById("metric-roi");
  roiPill.textContent = fmtPct(roi);
  roiPill.className = "side-pill" + (roi < 0 ? " negative" : "");
  document.getElementById("metric-roi-foot").textContent =
    `Sobre ${fmtDual(volumeApostadoResolved, volumeApostadoResolvedReais, false)} resolvido`;

  const comOdd = bets.filter(b => b.odd > 0);
  const oddMedia = comOdd.length > 0 ? comOdd.reduce((s, b) => s + b.odd, 0) / comOdd.length : 0;
  document.getElementById("metric-odd").textContent = comOdd.length > 0 ? oddMedia.toFixed(3).replace(".", ",") : "—";

  const porTipster = {};
  const porTipsterReais = {};
  resolved.forEach(b => {
    if (!b.tipster) return;
    porTipster[b.tipster] = (porTipster[b.tipster] || 0) + b.lucro_uni;
    porTipsterReais[b.tipster] = (porTipsterReais[b.tipster] || 0) + b.lucro_reais;
  });
  let melhorTipster = null, melhorValor = -Infinity;
  let piorTipster = null, piorValor = Infinity;
  Object.entries(porTipster).forEach(([t, v]) => {
    if (v > melhorValor) { melhorTipster = t; melhorValor = v; }
    if (v < piorValor) { piorTipster = t; piorValor = v; }
  });

  const mostrarMelhorPior = !ACTIVE_TIPSTER;
  document.getElementById("melhor-tipster-block").style.display = mostrarMelhorPior ? "" : "none";
  document.getElementById("pior-tipster-block").style.display = mostrarMelhorPior ? "" : "none";
  document.getElementById("ultimas-gerais-block").style.display = mostrarMelhorPior ? "" : "none";
  if (mostrarMelhorPior) {
    const ultimasGerais = resolved.slice()
      .sort((a, b) => (b.data_iso || "").localeCompare(a.data_iso || ""))
      .slice(0, 5);
    document.getElementById("ultimas-gerais-list").innerHTML = ultimasGerais.map(b => `
      <div class="ultima-tip-line">
        <span class="ultima-tip-tipster" title="${esc(b.tipster)}">${b.tipster || "—"}</span>
        <span class="ultima-tip-aposta" title="${esc(b.aposta)}">${b.aposta || "—"}</span>
        ${resultTag(b.resultado)}
      </div>
    `).join("") || `<div class="ultima-tip-line">Sem apostas resolvidas ainda.</div>`;
  }

  document.getElementById("ultimas-tips-block").style.display = ACTIVE_TIPSTER ? "" : "none";
  if (ACTIVE_TIPSTER) {
    const ultimas = bets.slice()
      .sort((a, b) => (b.data_iso || "").localeCompare(a.data_iso || ""))
      .slice(0, 10);
    document.getElementById("ultimas-tips-list").innerHTML = ultimas.map(b => {
      const cls = b.lucro_uni > 0 ? "positive" : b.lucro_uni < 0 ? "negative" : "";
      const valor = isResolved(b) ? fmtDual(b.lucro_uni, b.lucro_reais, true) : "—";
      return `
        <div class="ultima-tip-line">
          <span class="ultima-tip-aposta" title="${esc(b.aposta)}">${b.aposta || "—"}</span>
          <span class="ultima-tip-valor ${cls}">${valor}</span>
          ${resultTag(b.resultado)}
        </div>
      `;
    }).join("") || `<div class="ultima-tip-line">Sem apostas nesse filtro ainda.</div>`;
  }

  const periodoTexto = ACTIVE_MES ? "no mês" : "no ano";

  document.getElementById("metric-melhor-tipster").textContent = melhorTipster || "—";
  document.getElementById("metric-melhor-tipster-foot").innerHTML = melhorTipster
    ? `<b class="${melhorValor >= 0 ? "positive" : "negative"}">${fmtDual(melhorValor, porTipsterReais[melhorTipster] || 0, true)}</b> ${periodoTexto}`
    : "Sem dados suficientes";

  document.getElementById("metric-pior-tipster").textContent = piorTipster || "—";
  document.getElementById("metric-pior-tipster-foot").innerHTML = piorTipster
    ? `<b class="${piorValor >= 0 ? "positive" : "negative"}">${fmtDual(piorValor, porTipsterReais[piorTipster] || 0, true)}</b> ${periodoTexto}`
    : "Sem dados suficientes";

  const ultimasTipsBlock = document.getElementById("ultimas-tips-block");
  if (ACTIVE_TIPSTER) {
    ultimasTipsBlock.style.display = "";
    const ultimas = bets
      .filter(isResolved)
      .slice()
      .sort((a, b) => (b.data_iso || "").localeCompare(a.data_iso || ""))
      .slice(0, 10);
    const listEl = document.getElementById("ultimas-tips-list");
    listEl.innerHTML = ultimas.length
      ? ultimas.map(b => `
          <div class="ultima-tip-line">
            <span class="ultima-tip-aposta" title="${esc(b.aposta)}">${b.aposta || "—"}</span>
            <span class="ultima-tip-valor ${b.lucro_uni > 0 ? "positive" : b.lucro_uni < 0 ? "negative" : ""}">${fmtDual(b.lucro_uni, b.lucro_reais, true)}</span>
            ${resultTag(b.resultado)}
          </div>
        `).join("")
      : `<span class="side-note">Sem apostas resolvidas ainda.</span>`;
  } else {
    ultimasTipsBlock.style.display = "none";
  }

  document.getElementById("side-filtered").textContent =
    [ACTIVE_TIPSTER, ACTIVE_MES ? formatMesLabel(ACTIVE_MES) : null].filter(Boolean).length
      ? `Filtrado: ${[ACTIVE_TIPSTER, ACTIVE_MES ? formatMesLabel(ACTIVE_MES) : null].filter(Boolean).join(" · ")}`
      : "Todas as apostas";
  document.getElementById("chart-title").textContent =
    ACTIVE_TIPSTER ? `Resultado acumulado (${ACTIVE_TIPSTER})` : "Resultado acumulado";

  renderChart(resolved);
  renderHistorico();
  if (CURRENT_VIEW === "ranking") renderRanking();
  if (CURRENT_VIEW === "bancas") loadBancas();
}

// ---------- Gráfico ----------
function renderChart(resolvedBets) {
  const porDiaUni = {};
  const porDiaReais = {};
  resolvedBets.forEach(b => {
    if (!b.data_iso) return;
    porDiaUni[b.data_iso] = (porDiaUni[b.data_iso] || 0) + b.lucro_uni;
    porDiaReais[b.data_iso] = (porDiaReais[b.data_iso] || 0) + b.lucro_reais;
  });
  const dias = Object.keys(porDiaUni).sort();

  let acumuladoUni = 0, acumuladoReais = 0;
  let picoUni = -Infinity, picoReais = -Infinity;
  let runningPeakUni = -Infinity, runningPeakReais = -Infinity;
  let maiorQuedaUni = 0, maiorQuedaReais = 0;
  const acumuladoSerieUni = [];
  const acumuladoSerieReais = [];
  const diarioSerieUni = [];
  const diarioSerieReais = [];

  dias.forEach(d => {
    acumuladoUni += porDiaUni[d];
    acumuladoReais += porDiaReais[d];
    diarioSerieUni.push(porDiaUni[d]);
    diarioSerieReais.push(porDiaReais[d]);
    acumuladoSerieUni.push(acumuladoUni);
    acumuladoSerieReais.push(acumuladoReais);
    if (acumuladoUni > picoUni) picoUni = acumuladoUni;
    if (acumuladoReais > picoReais) picoReais = acumuladoReais;
    if (acumuladoUni > runningPeakUni) runningPeakUni = acumuladoUni;
    if (acumuladoReais > runningPeakReais) runningPeakReais = acumuladoReais;
    const quedaUni = runningPeakUni - acumuladoUni;
    const quedaReais = runningPeakReais - acumuladoReais;
    if (quedaUni > maiorQuedaUni) maiorQuedaUni = quedaUni;
    if (quedaReais > maiorQuedaReais) maiorQuedaReais = quedaReais;
  });

  const fimUni = acumuladoSerieUni.length ? acumuladoSerieUni[acumuladoSerieUni.length - 1] : 0;
  const fimReais = acumuladoSerieReais.length ? acumuladoSerieReais[acumuladoSerieReais.length - 1] : 0;
  const labels = dias.map(d => {
    const [y, m, day] = d.split("-");
    return `${day}/${m}`;
  });

  const summaryEl = document.getElementById("chart-summary");
  if (!dias.length) {
    summaryEl.innerHTML = `<div class="chart-summary-row">Sem apostas resolvidas nesse filtro ainda.</div>`;
  } else {
    const fimVal = SHOW_BRL ? fimReais : fimUni;
    const fimCor = fimVal >= 0 ? "var(--green)" : "var(--red)";
    summaryEl.innerHTML = `
      <div class="chart-summary-row">${resolvedBets.length} apostas em ${dias.length} dias</div>
      <div class="chart-summary-row">${ICON_TREND_UP} Pico: <b style="color:var(--green)">${fmtDual(picoUni, picoReais, true)}</b></div>
      <div class="chart-summary-row">${ICON_TREND_DOWN} Maior Drawdown: <b style="color:var(--red)">${fmtDual(-maiorQuedaUni, -maiorQuedaReais, false)}</b></div>
      <div class="chart-summary-row">${ICON_TARGET} Atual: <b style="color:${fimCor}">${fmtDual(fimUni, fimReais, true)}</b></div>
    `;
  }

  const diarioDisplay = SHOW_BRL ? diarioSerieReais : diarioSerieUni;
  const acumuladoDisplay = SHOW_BRL ? acumuladoSerieReais : acumuladoSerieUni;

  const ctx = document.getElementById("results-chart").getContext("2d");
  if (chartInstance) chartInstance.destroy();

  // desenha o valor de cada barra em cima dela — só quando um mês específico
  // está filtrado (com muitos dias juntos, os números viram bagunça), e só
  // fora do mobile (a tela é estreita demais pra caber os números)
  const barValueLabelPlugin = {
    id: "barValueLabels",
    afterDatasetsDraw(chart) {
      if (!ACTIVE_MES) return;
      if (window.innerWidth <= 900) return;
      const meta = chart.getDatasetMeta(0);
      const dataset = chart.data.datasets[0];
      const c = chart.ctx;
      c.save();
      c.font = "bold 11px Montserrat, sans-serif";
      c.textAlign = "center";
      meta.data.forEach((bar, i) => {
        const value = dataset.data[i];
        const label = SHOW_BRL ? fmtBRL(value, true) : fmtUnits(value, true);
        c.fillStyle = value >= 0 ? "#2e7d32" : "#c62828";
        const y = value >= 0 ? bar.y - 6 : bar.y + 16;
        c.fillText(label, bar.x, y);
      });
      c.restore();
    },
  };

  const gridColor = document.body.classList.contains("dark-mode") ? "rgba(255,255,255,0.08)" : "#eef1f6";
  const tickColor = document.body.classList.contains("dark-mode") ? "#8b93b3" : "#7a8494";

  chartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          type: "bar",
          label: "Resultado do dia",
          data: diarioDisplay,
          backgroundColor: diarioDisplay.map(v => v >= 0 ? "#8bc34a" : "#e2453c"),
          borderRadius: 4,
          order: 2,
          yAxisID: "y",
        },
        {
          type: "line",
          label: "Acumulado",
          data: acumuladoDisplay,
          borderColor: "#6fa72e",
          backgroundColor: "rgba(111,167,46,0.12)",
          fill: true,
          tension: 0.35,
          pointRadius: 2,
          borderWidth: 2,
          order: 1,
          yAxisID: "y",
        },
      ],
    },
    plugins: [barValueLabelPlugin],
    options: {
      responsive: true,
      layout: { padding: { top: 24 } },
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (item) => `${item.dataset.label}: ${SHOW_BRL ? fmtBRL(item.raw, true) : fmtUnits(item.raw, true)}`,
          },
        },
      },
      scales: {
        y: {
          grid: { color: gridColor },
          ticks: {
            color: tickColor,
            callback: (v) => SHOW_BRL
              ? `R$ ${Number(v).toLocaleString("pt-BR")}`
              : `${v}u`,
          },
        },
        x: { grid: { display: false }, ticks: { color: tickColor } },
      },
    },
  });
}

document.getElementById("refresh-btn").addEventListener("click", () => loadData(true));

setupSortableHeaders(HIST_HEADERS, "hist", renderHistorico);
setupSortableHeaders(RANK_HEADERS, "rank", renderRanking);
setupSortableHeaders(BANCA_HEADERS, "banca", renderBancasTable);

// aplica o modo noturno salvo (se houver) antes de tudo
document.getElementById("toggle-dark").innerHTML = ICON_MOON;
try {
  setDarkMode(localStorage.getItem("painel_dark_mode") === "1");
} catch (e) {}

setToday();
loadData();
