const USER_NAME = "Luís";
const MESES_PT = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

let ALL_BETS = [];
let ACTIVE_TIPSTER = null;
let ACTIVE_MES = null;
let ONLY_PENDING = false;
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

// ---------- Modo noturno ----------
function setDarkMode(on) {
  document.body.classList.toggle("dark-mode", on);
  document.getElementById("toggle-dark").textContent = on ? "☀️" : "🌙";
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
  document.getElementById("subtitle").textContent = showBRL ? "Valores em reais." : "Valores em unidades.";
  renderAll();
}

document.getElementById("toggle-uni").addEventListener("click", () => setCurrency(false));
document.getElementById("toggle-real").addEventListener("click", () => setCurrency(true));

// ---------- Carregar dados ----------
async function loadData() {
  const errorBox = document.getElementById("error-box");
  errorBox.style.display = "none";
  try {
    const res = await fetch("/api/bets");
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Erro desconhecido");
    ALL_BETS = data.bets;
    EDITING_IDX = null;
    tryAutoSelectMonth();
    renderMesChips();
    renderChips();
    renderAll();
  } catch (err) {
    errorBox.style.display = "block";
    errorBox.textContent = "Não consegui carregar os dados da planilha: " + err.message;
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
  if (!ACTIVE_MES) {
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
}

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
    chip.textContent = m;
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
}

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
  if (ACTIVE_MES) filtros.push({ label: `Mês: ${ACTIVE_MES}`, clear: () => { ACTIVE_MES = null; ACTIVE_TIPSTER = null; } });
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
  document.getElementById("view-geral").style.display = view === "geral" ? "" : "none";
  document.getElementById("view-historico").style.display = view === "historico" ? "" : "none";
  document.getElementById("nav-geral").classList.toggle("active", view === "geral");
  document.getElementById("nav-historico").classList.toggle("active", view === "historico");
  if (view === "historico") renderHistorico();
}

document.getElementById("nav-geral").addEventListener("click", () => switchView("geral"));
document.getElementById("nav-historico").addEventListener("click", () => {
  ONLY_PENDING = false;
  switchView("historico");
});

document.getElementById("card-aberto").addEventListener("click", () => {
  ONLY_PENDING = true;
  EDITING_IDX = null;
  switchView("historico");
});

document.getElementById("clear-pending-filter").addEventListener("click", () => {
  ONLY_PENDING = false;
  renderHistorico();
});

// ---------- Selos de casa ----------
const CASA_STYLE = {
  "bet365":      { initials: "B3", color: "#1c5c34" },
  "betbra":      { initials: "BR", color: "#1a2b52" },
  "bolsa":       { initials: "BR", color: "#1a2b52" },
  "superbet":    { initials: "SU", color: "#7a1220" },
  "betano":      { initials: "BA", color: "#e8631c" },
  "sportingbet": { initials: "SP", color: "#1c3f7a" },
  "1win":        { initials: "1W", color: "#1a1a1a" },
  "betboo":      { initials: "BB", color: "#6b1f3d" },
};

function casaBadge(casa) {
  const key = (casa || "").toLowerCase();
  const style = CASA_STYLE[key] || { initials: (casa || "?").slice(0, 2).toUpperCase(), color: "#7a8494" };
  return `
    <span class="casa-cell">
      <span class="casa-badge" style="background:${style.color}">${style.initials}</span>
      ${casa || "—"}
    </span>
  `;
}

function resultTag(resultado) {
  const r = (resultado || "").toLowerCase();
  if (r === "green") return `<span class="result-tag green">✓</span>`;
  if (r === "red") return `<span class="result-tag red">✗</span>`;
  if (r === "void") return `<span class="result-tag void">–</span>`;
  return `<span class="result-tag pending">•</span>`;
}

// ---------- Marcar resultado (Green/Red/Void) ----------
async function resolveBetByIndex(idx, resultado) {
  const bet = CURRENT_HISTORICO_BETS[idx];
  if (!bet) return;
  try {
    const res = await fetch("/api/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mes: bet.mes, row: bet.row, resultado }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Erro ao marcar resultado");
    await loadData();
    switchView("historico");
  } catch (err) {
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
    mercado: document.getElementById(`edit-mercado-${idx}`).value,
    odd: document.getElementById(`edit-odd-${idx}`).value,
    stake: document.getElementById(`edit-stake-${idx}`).value,
    resultado: document.getElementById(`edit-resultado-${idx}`).value,
  };
  try {
    const res = await fetch("/api/update_bet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mes: bet.mes, row: bet.row, updates }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Erro ao salvar");
    EDITING_IDX = null;
    await loadData();
    switchView("historico");
  } catch (err) {
    alert("Não consegui salvar: " + err.message);
  }
}

// ---------- Tabela de histórico ----------
function renderHistorico() {
  const tbody = document.getElementById("bets-table-body");
  if (!tbody) return;

  const bets = currentBets()
    .slice()
    .sort((a, b) => (b.data_iso || "").localeCompare(a.data_iso || ""));

  CURRENT_HISTORICO_BETS = bets;

  document.getElementById("pending-banner").style.display = ONLY_PENDING ? "flex" : "none";

  tbody.innerHTML = bets.map((b, idx) => {
    const uniClass = b.lucro_uni > 0 ? "positive" : b.lucro_uni < 0 ? "negative" : "";
    const editing = EDITING_IDX === idx;

    if (editing) {
      return `
        <tr>
          <td>${b.mes || "—"}</td>
          <td><input class="edit-input small" id="edit-data-${idx}" value="${esc(b.data)}"></td>
          <td><input class="edit-input" id="edit-casa-${idx}" value="${esc(b.casa)}"></td>
          <td><input class="edit-input" id="edit-tipster-${idx}" value="${esc(b.tipster)}"></td>
          <td><input class="edit-input" id="edit-aposta-${idx}" value="${esc(b.aposta)}"></td>
          <td><input class="edit-input" id="edit-mercado-${idx}" value="${esc(b.mercado)}"></td>
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
           <button class="resolve-btn red" title="Red" onclick="resolveBetByIndex(${idx}, 'Red')">✗</button>
           <button class="resolve-btn void" title="Void" onclick="resolveBetByIndex(${idx}, 'Void')">–</button>
         </div>`;

    return `
      <tr>
        <td>${b.mes || "—"}</td>
        <td>${b.data || "—"}</td>
        <td>${casaBadge(b.casa)}</td>
        <td>${b.tipster || "—"}</td>
        <td>${b.aposta || "—"}</td>
        <td>${b.mercado || "—"}</td>
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
  if (ONLY_PENDING) result = result.filter(b => !isResolved(b));
  return result;
}

// ---------- Visão geral (cards + gráfico) ----------
function renderAll() {
  renderActiveFiltersBar();

  const bets = currentBets();
  const resolved = bets.filter(isResolved);
  const pending = bets.filter(b => !isResolved(b));

  const resultadoLiquido = resolved.reduce((s, b) => s + b.lucro_uni, 0);
  const resultadoLiquidoReais = resolved.reduce((s, b) => s + b.lucro_reais, 0);
  const volumeApostadoResolved = resolved.reduce((s, b) => s + b.stake, 0);
  const volumeApostadoResolvedReais = resolved.reduce((s, b) => s + b.stake_reais, 0);
  const roi = volumeApostadoResolved > 0 ? (resultadoLiquido / volumeApostadoResolved) * 100 : 0;

  document.getElementById("metric-liquido").textContent = fmtDual(resultadoLiquido, resultadoLiquidoReais, true);
  document.getElementById("metric-liquido-foot").textContent =
    `ROI sobre ${fmtDual(volumeApostadoResolved, volumeApostadoResolvedReais, false)} resolvido`;

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
  document.getElementById("metric-acerto-foot").textContent = `${greens} positivas em ${decisoes} decisões`;

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
  Object.entries(porTipster).forEach(([t, v]) => {
    if (v > melhorValor) { melhorTipster = t; melhorValor = v; }
  });
  document.getElementById("metric-melhor-tipster").textContent = melhorTipster || "—";
  document.getElementById("metric-melhor-tipster-foot").textContent =
    melhorTipster ? `${fmtDual(melhorValor, porTipsterReais[melhorTipster] || 0, true)} de resultado` : "Sem dados suficientes";

  document.getElementById("side-filtered").textContent =
    [ACTIVE_TIPSTER, ACTIVE_MES].filter(Boolean).length
      ? `Filtrado: ${[ACTIVE_TIPSTER, ACTIVE_MES].filter(Boolean).join(" · ")}`
      : "Todas as apostas";
  document.getElementById("chart-title").textContent =
    ACTIVE_TIPSTER ? `Resultado acumulado (${ACTIVE_TIPSTER})` : "Resultado acumulado";

  renderChart(resolved);
  renderHistorico();
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
    summaryEl.textContent = "Sem apostas resolvidas nesse filtro ainda.";
  } else {
    const fimCor = (SHOW_BRL ? fimReais : fimUni) >= 0 ? "var(--green)" : "var(--red)";
    summaryEl.innerHTML =
      `${resolvedBets.length} apostas em ${dias.length} dias · pico <b>${fmtDual(picoUni, picoReais, false)}</b>` +
      ` · maior queda <b style="color:var(--red)">${fmtDual(Math.abs(maiorQuedaUni), Math.abs(maiorQuedaReais), false)}</b>` +
      ` · fim <b style="color:${fimCor}">${fmtDual(fimUni, fimReais, true)}</b>`;
  }

  const diarioDisplay = SHOW_BRL ? diarioSerieReais : diarioSerieUni;
  const acumuladoDisplay = SHOW_BRL ? acumuladoSerieReais : acumuladoSerieUni;

  const ctx = document.getElementById("results-chart").getContext("2d");
  if (chartInstance) chartInstance.destroy();

  // desenha o valor de cada barra em cima dela (sem precisar de plugin externo)
  const barValueLabelPlugin = {
    id: "barValueLabels",
    afterDatasetsDraw(chart) {
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

document.getElementById("refresh-btn").addEventListener("click", loadData);

// aplica o modo noturno salvo (se houver) antes de tudo
try {
  setDarkMode(localStorage.getItem("painel_dark_mode") === "1");
} catch (e) {}

setToday();
loadData();
