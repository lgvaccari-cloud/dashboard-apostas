const USER_NAME = "Luís";

let ALL_BETS = [];
let ACTIVE_TIPSTER = null;
let chartInstance = null;
let CURRENT_VIEW = "geral";
let SHOW_BRL = false;

const RESOLVED_RESULTS = ["green", "red", "void"];

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

function setCurrency(showBRL) {
  SHOW_BRL = showBRL;
  document.getElementById("toggle-uni").classList.toggle("active", !showBRL);
  document.getElementById("toggle-real").classList.toggle("active", showBRL);
  document.getElementById("subtitle").textContent = showBRL ? "Valores em reais." : "Valores em unidades.";
  renderAll();
}

document.getElementById("toggle-uni").addEventListener("click", () => setCurrency(false));
document.getElementById("toggle-real").addEventListener("click", () => setCurrency(true));

async function loadData() {
  const errorBox = document.getElementById("error-box");
  errorBox.style.display = "none";
  try {
    const res = await fetch("/api/bets");
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Erro desconhecido");
    ALL_BETS = data.bets;
    renderChips();
    renderAll();
  } catch (err) {
    errorBox.style.display = "block";
    errorBox.textContent = "Não consegui carregar os dados da planilha: " + err.message;
  }
}

function renderChips() {
  const tipsters = [...new Set(ALL_BETS.map(b => b.tipster).filter(Boolean))].sort();
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

function switchView(view) {
  CURRENT_VIEW = view;
  document.getElementById("view-geral").style.display = view === "geral" ? "" : "none";
  document.getElementById("view-historico").style.display = view === "historico" ? "" : "none";
  document.getElementById("nav-geral").classList.toggle("active", view === "geral");
  document.getElementById("nav-historico").classList.toggle("active", view === "historico");
  if (view === "historico") renderHistorico();
}

document.getElementById("nav-geral").addEventListener("click", () => switchView("geral"));
document.getElementById("nav-historico").addEventListener("click", () => switchView("historico"));

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

function renderHistorico() {
  const tbody = document.getElementById("bets-table-body");
  if (!tbody) return;
  const bets = currentBets()
    .slice()
    .sort((a, b) => (b.data_iso || "").localeCompare(a.data_iso || ""));

  tbody.innerHTML = bets.map(b => {
    const uniClass = b.lucro_uni > 0 ? "positive" : b.lucro_uni < 0 ? "negative" : "";
    return `
      <tr>
        <td>${b.data || "—"}</td>
        <td>${casaBadge(b.casa)}</td>
        <td>${b.tipster || "—"}</td>
        <td>${b.aposta || "—"}</td>
        <td>${b.mercado || "—"}</td>
        <td>${b.odd ? b.odd.toFixed(3).replace(".", ",") : "—"}</td>
        <td>${b.stake ? fmtDual(b.stake, b.stake_reais, false) : "—"}</td>
        <td>${resultTag(b.resultado)}</td>
        <td class="uni-cell ${uniClass}">${isResolved(b) ? fmtDual(b.lucro_uni, b.lucro_reais, true) : "—"}</td>
      </tr>
    `;
  }).join("");
}

function currentBets() {
  if (!ACTIVE_TIPSTER) return ALL_BETS;
  return ALL_BETS.filter(b => b.tipster === ACTIVE_TIPSTER);
}

function renderAll() {
  const bets = currentBets();
  const resolved = bets.filter(isResolved);
  const pending = bets.filter(b => !isResolved(b));

  // Resultado líquido / ROI
  const resultadoLiquido = resolved.reduce((s, b) => s + b.lucro_uni, 0);
  const resultadoLiquidoReais = resolved.reduce((s, b) => s + b.lucro_reais, 0);
  const volumeApostadoResolved = resolved.reduce((s, b) => s + b.stake, 0);
  const volumeApostadoResolvedReais = resolved.reduce((s, b) => s + b.stake_reais, 0);
  const roi = volumeApostadoResolved > 0 ? (resultadoLiquido / volumeApostadoResolved) * 100 : 0;

  document.getElementById("metric-liquido").textContent = fmtDual(resultadoLiquido, resultadoLiquidoReais, true);
  document.getElementById("metric-liquido-foot").textContent =
    `ROI sobre ${fmtDual(volumeApostadoResolved, volumeApostadoResolvedReais, false)} resolvido`;

  // Em aberto
  const emAberto = pending.reduce((s, b) => s + b.stake, 0);
  const emAbertoReais = pending.reduce((s, b) => s + b.stake_reais, 0);
  document.getElementById("metric-aberto").textContent = fmtDual(emAberto, emAbertoReais, false);
  document.getElementById("metric-aberto-foot").textContent = `${pending.length} pendentes`;

  // Volume apostado
  document.getElementById("metric-volume").textContent = fmtDual(volumeApostadoResolved, volumeApostadoResolvedReais, false);
  document.getElementById("metric-volume-foot").textContent = `${resolved.length} resolvidas`;

  // Lucro / prejuízo bruto
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

  // Taxa de acerto (green vs red, void fora da conta)
  const greens = resolved.filter(b => (b.resultado || "").toLowerCase() === "green").length;
  const reds = resolved.filter(b => (b.resultado || "").toLowerCase() === "red").length;
  const decisoes = greens + reds;
  const taxaAcerto = decisoes > 0 ? (greens / decisoes) * 100 : 0;

  document.getElementById("metric-acerto").textContent = decisoes > 0 ? `${taxaAcerto.toFixed(1).replace(".", ",")}%` : "—";
  document.getElementById("acerto-bar").style.width = `${taxaAcerto}%`;
  document.getElementById("metric-acerto-foot").textContent = `${greens} positivas em ${decisoes} decisões`;

  // ROI (painel lateral)
  const roiPill = document.getElementById("metric-roi");
  roiPill.textContent = fmtPct(roi);
  roiPill.className = "side-pill" + (roi < 0 ? " negative" : "");
  document.getElementById("metric-roi-foot").textContent =
    `Sobre ${fmtDual(volumeApostadoResolved, volumeApostadoResolvedReais, false)} resolvido`;

  // Odd média (todas as apostas filtradas, com odd > 0)
  const comOdd = bets.filter(b => b.odd > 0);
  const oddMedia = comOdd.length > 0 ? comOdd.reduce((s, b) => s + b.odd, 0) / comOdd.length : 0;
  document.getElementById("metric-odd").textContent = comOdd.length > 0 ? oddMedia.toFixed(3).replace(".", ",") : "—";

  // Melhor tipster (dentro do conjunto filtrado) — ranking sempre por unidades,
  // mas mostra o valor exato em reais quando esse for o modo ativo
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
    ACTIVE_TIPSTER ? `Filtrado: ${ACTIVE_TIPSTER}` : "Todas as apostas";
  document.getElementById("chart-title").textContent =
    ACTIVE_TIPSTER ? `Resultado acumulado (${ACTIVE_TIPSTER})` : "Resultado acumulado";

  renderChart(resolved);
  renderHistorico();
}

function renderChart(resolvedBets) {
  // agrupa por dia (unidades e reais, em paralelo)
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

  document.getElementById("chart-summary").textContent = dias.length
    ? `${resolvedBets.length} apostas em ${dias.length} dias · pico ${fmtDual(picoUni, picoReais, true)} · maior queda ${fmtDual(-maiorQuedaUni, -maiorQuedaReais, false)} · fim ${fmtDual(fimUni, fimReais, true)}`
    : "Sem apostas resolvidas nesse filtro ainda.";

  const diarioDisplay = SHOW_BRL ? diarioSerieReais : diarioSerieUni;
  const acumuladoDisplay = SHOW_BRL ? acumuladoSerieReais : acumuladoSerieUni;

  const ctx = document.getElementById("results-chart").getContext("2d");
  if (chartInstance) chartInstance.destroy();

  chartInstance = new Chart(ctx, {
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
    options: {
      responsive: true,
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
          grid: { color: "#eef1f6" },
          ticks: {
            callback: (v) => SHOW_BRL
              ? `R$ ${Number(v).toLocaleString("pt-BR")}`
              : `${v}u`,
          },
        },
        x: { grid: { display: false } },
      },
    },
  });
}

document.getElementById("refresh-btn").addEventListener("click", loadData);

setToday();
loadData();
