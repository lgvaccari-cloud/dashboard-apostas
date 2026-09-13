let ALL_BETS = [];
let ACTIVE_TIPSTER = null;
let chartInstance = null;

const RESOLVED_RESULTS = ["green", "red", "void"];

function fmtUnits(n, sign) {
  const s = n.toFixed(2).replace(".", ",");
  if (sign && n > 0) return `+${s}u`;
  return `${s}u`;
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
  document.getElementById("greeting").textContent = saud + ".";
}

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
  const volumeApostadoResolved = resolved.reduce((s, b) => s + b.stake, 0);
  const roi = volumeApostadoResolved > 0 ? (resultadoLiquido / volumeApostadoResolved) * 100 : 0;

  document.getElementById("metric-liquido").textContent = fmtUnits(resultadoLiquido, true);
  document.getElementById("metric-liquido-foot").textContent =
    `ROI sobre ${volumeApostadoResolved.toFixed(2).replace(".", ",")}u resolvido`;

  // Em aberto
  const emAberto = pending.reduce((s, b) => s + b.stake, 0);
  document.getElementById("metric-aberto").textContent = fmtUnits(emAberto, false);
  document.getElementById("metric-aberto-foot").textContent = `${pending.length} pendentes`;

  // Volume apostado
  document.getElementById("metric-volume").textContent = fmtUnits(volumeApostadoResolved, false);
  document.getElementById("metric-volume-foot").textContent = `${resolved.length} resolvidas`;

  // Lucro / prejuízo bruto
  const ganhos = resolved.filter(b => b.lucro_uni > 0);
  const perdas = resolved.filter(b => b.lucro_uni < 0);
  const lucroBruto = ganhos.reduce((s, b) => s + b.lucro_uni, 0);
  const prejuizoBruto = Math.abs(perdas.reduce((s, b) => s + b.lucro_uni, 0));

  document.getElementById("metric-lucro").textContent = fmtUnits(lucroBruto, false);
  document.getElementById("metric-lucro-foot").textContent = `${ganhos.length} com lucro`;
  document.getElementById("metric-prejuizo").textContent = fmtUnits(prejuizoBruto, false);
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
    `Sobre ${volumeApostadoResolved.toFixed(2).replace(".", ",")}u resolvido`;

  // Odd média (todas as apostas filtradas, com odd > 0)
  const comOdd = bets.filter(b => b.odd > 0);
  const oddMedia = comOdd.length > 0 ? comOdd.reduce((s, b) => s + b.odd, 0) / comOdd.length : 0;
  document.getElementById("metric-odd").textContent = comOdd.length > 0 ? oddMedia.toFixed(3).replace(".", ",") : "—";

  // Melhor tipster (dentro do conjunto filtrado)
  const porTipster = {};
  resolved.forEach(b => {
    if (!b.tipster) return;
    porTipster[b.tipster] = (porTipster[b.tipster] || 0) + b.lucro_uni;
  });
  let melhorTipster = null, melhorValor = -Infinity;
  Object.entries(porTipster).forEach(([t, v]) => {
    if (v > melhorValor) { melhorTipster = t; melhorValor = v; }
  });
  document.getElementById("metric-melhor-tipster").textContent = melhorTipster || "—";
  document.getElementById("metric-melhor-tipster-foot").textContent =
    melhorTipster ? `${fmtUnits(melhorValor, true)} de resultado` : "Sem dados suficientes";

  document.getElementById("side-filtered").textContent =
    ACTIVE_TIPSTER ? `Filtrado: ${ACTIVE_TIPSTER}` : "Todas as apostas";
  document.getElementById("chart-title").textContent =
    ACTIVE_TIPSTER ? `Resultado acumulado (${ACTIVE_TIPSTER})` : "Resultado acumulado";

  renderChart(resolved);
}

function renderChart(resolvedBets) {
  // agrupa por dia
  const porDia = {};
  resolvedBets.forEach(b => {
    if (!b.data_iso) return;
    porDia[b.data_iso] = (porDia[b.data_iso] || 0) + b.lucro_uni;
  });
  const dias = Object.keys(porDia).sort();

  let acumulado = 0;
  let pico = -Infinity;
  let runningPeak = -Infinity;
  let maiorQueda = 0;
  const acumuladoSerie = [];
  const diarioSerie = [];

  dias.forEach(d => {
    const valorDia = porDia[d];
    acumulado += valorDia;
    diarioSerie.push(valorDia);
    acumuladoSerie.push(acumulado);
    if (acumulado > pico) pico = acumulado;
    if (acumulado > runningPeak) runningPeak = acumulado;
    const queda = runningPeak - acumulado;
    if (queda > maiorQueda) maiorQueda = queda;
  });

  const fim = acumuladoSerie.length ? acumuladoSerie[acumuladoSerie.length - 1] : 0;
  const labels = dias.map(d => {
    const [y, m, day] = d.split("-");
    return `${day}/${m}`;
  });

  document.getElementById("chart-summary").textContent = dias.length
    ? `${resolvedBets.length} apostas em ${dias.length} dias · pico ${fmtUnits(pico, true)} · maior queda -${maiorQueda.toFixed(2).replace(".", ",")}u · fim ${fmtUnits(fim, true)}`
    : "Sem apostas resolvidas nesse filtro ainda.";

  const ctx = document.getElementById("results-chart").getContext("2d");
  if (chartInstance) chartInstance.destroy();

  chartInstance = new Chart(ctx, {
    data: {
      labels,
      datasets: [
        {
          type: "bar",
          label: "Resultado do dia",
          data: diarioSerie,
          backgroundColor: diarioSerie.map(v => v >= 0 ? "#8bc34a" : "#e2453c"),
          borderRadius: 4,
          order: 2,
          yAxisID: "y",
        },
        {
          type: "line",
          label: "Acumulado",
          data: acumuladoSerie,
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
            label: (item) => `${item.dataset.label}: ${fmtUnits(item.raw, true)}`,
          },
        },
      },
      scales: {
        y: { grid: { color: "#eef1f6" }, ticks: { callback: (v) => `${v}u` } },
        x: { grid: { display: false } },
      },
    },
  });
}

document.getElementById("refresh-btn").addEventListener("click", loadData);

setToday();
loadData();
