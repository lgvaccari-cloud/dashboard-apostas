const USER_NAME = "Luís Vaccari";
const MESES_PT = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

const ICON_TREND_UP = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l6-6 4 4 8-8"/><path d="M17 7h4v4"/></svg>`;
const ICON_TREND_DOWN = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7l6 6 4-4 8 8"/><path d="M17 17h4v-4"/></svg>`;
const ICON_ALERTA = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.3 1.8 17.5A2 2 0 0 0 3.5 20.5h17a2 2 0 0 0 1.7-3L13.7 3.3a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4"/><path d="M12 17h.01"/></svg>`;
const ICON_TARGET = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1" fill="currentColor"/></svg>`;

let ALL_BETS = [];
let TIPSTERS_REGISTRY = [];
let CASAS_REGISTRY = [];
let ACTIVE_TIPSTER = null;
let ACTIVE_CASA = null;
let NEW_BET_TIPO = "";
let ACTIVE_MES = null;
let ONLY_PENDING = false;
let ONLY_TODAY = false;
let ONLY_YESTERDAY = false;
let ONLY_PENDING_TODAY = false;
let ONLY_PENDING_FUTURE = false;
let SEARCH_QUERY = "";
// Cards recolhidos no Histórico, por "mês::linha" — sobrevive a re-renders
// (troca de filtro, resolver aposta) dentro da mesma sessão.
const COLLAPSED_CARDS = new Set();

function cardKey(b) {
  return `${b.mes}::${b.row}`;
}

function toggleCardCollapse(ev, key) {
  if (COLLAPSED_CARDS.has(key)) COLLAPSED_CARDS.delete(key);
  else COLLAPSED_CARDS.add(key);
  const card = ev.currentTarget.closest(".bet-card");
  if (card) card.classList.toggle("collapsed");
}
let RANK_ONLY_TODAY = false;
let RANK_ONLY_YESTERDAY = false;
let AUTO_MES_APPLIED = false;
let chartInstance = null;
let CURRENT_VIEW = "geral";
let SHOW_BRL = true;
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

// ---------- Ordenação cronológica dos meses ----------
function stripAcentos(s) {
  return String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

const MES_INDEX = {};
MESES_PT.forEach((nome, i) => { MES_INDEX[stripAcentos(nome)] = i; });

// "Setembro/2026" -> número comparável (ano*12 + índice do mês). null se não der pra ler.
function mesSortKey(mes) {
  const partes = String(mes).toLowerCase().trim().split("/");
  const nome = stripAcentos(partes[0].trim());
  const ano = parseInt(partes[1], 10);
  const idx = MES_INDEX[nome];
  if (idx === undefined || isNaN(ano)) return null;
  return ano * 12 + idx;
}

// Mais recente primeiro. Meses que não derem pra interpretar vão pro fim, na ordem original.
function sortMeses(meses) {
  return [...meses].sort((a, b) => {
    const ka = mesSortKey(a);
    const kb = mesSortKey(b);
    if (ka === null && kb === null) return 0;
    if (ka === null) return 1;
    if (kb === null) return -1;
    return kb - ka;
  });
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

// mais recente primeiro; dentro do mesmo dia, a linha mais nova da planilha
// (maior número de linha) aparece primeiro
function compareRecentFirst(a, b) {
  const porData = (b.data_hora_sort || b.data_iso || "").localeCompare(a.data_hora_sort || a.data_iso || "");
  if (porData !== 0) return porData;
  return (b.row || 0) - (a.row || 0);
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

// odd sempre com ponto decimal (não vírgula). Mostra a 3ª casa só quando ela
// existe de verdade: 1.80 fica "1.80", 1.675 fica "1.675".
// Logo da casa, quando existe em static/logos/<slug>.png|svg. Sem arquivo
// pra essa casa, cai sozinho no texto (o onerror troca a tag inteira).
// Cor de fundo de cada logo (extraída dos cantos da imagem original), pra
// o chip "emendar" com o logo em vez de deixar uma borda branca/cinza ao
// redor. Casa sem entrada aqui usa o fundo neutro do tema (var(--bg)).
const CASA_LOGO_BG = {
  "bet365": "#027b5b",
  "betbra": "#1d1d1d",
  "superbet": "#ff0000",
  "betano": "#ff3c00",
  "betboo": "#c93b19",
  "sportingbet": "#249ad7",
  "1win": "#141415",
  "pinnacle": "#1f273d",
  "bolsa": "#000105",
};

function slugCasa(casa) {
  return String(casa || "").toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function casaBadgeHtml(casa) {
  if (!casa) return `<span class="bet-card-casa">—</span>`;
  const slug = slugCasa(casa);
  const fallback = `<span class="bet-card-casa">${esc(casa)}</span>`.replace(/"/g, "&quot;");
  const bgCor = CASA_LOGO_BG[slug];
  const chipStyle = bgCor ? ` style="background:${bgCor};border-color:${bgCor}"` : "";
  return `<span class="bet-card-casa-chip"${chipStyle}><img src="/static/logos/${slug}.png" alt="${esc(casa)}" title="${esc(casa)}" class="bet-card-casa-logo" onerror="this.parentElement.outerHTML='${fallback}'"></span>`;
}

// Formata o horário digitado pra "HH:MM" quando a pessoa sai do campo —
// aceita puro dígitos, sem precisar digitar o ":" ("0900" -> "09:00",
// "1240" -> "12:40", "930" -> "09:30", "9" -> "09:00"). Não mexe em campo
// vazio, e trava hora/minuto em valores válidos (23/59 no máximo).
function formatHorarioInput(el) {
  const v = (el.value || "").trim();
  if (!v) return;
  const digitos = v.replace(/\D/g, "");
  if (!digitos) return;
  let h, m;
  if (digitos.length <= 2) { h = digitos; m = "00"; }
  else if (digitos.length === 3) { h = "0" + digitos[0]; m = digitos.slice(1); }
  else { h = digitos.slice(0, 2); m = digitos.slice(2, 4); }
  h = String(Math.min(23, parseInt(h, 10) || 0)).padStart(2, "0");
  m = String(Math.min(59, parseInt(m, 10) || 0)).padStart(2, "0");
  el.value = `${h}:${m}`;
}

function horaAtualHHMM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function fmtOdd(odd) {
  const tres = Number(odd).toFixed(3);
  return tres.endsWith("0") ? tres.slice(0, -1) : tres;
}

// Stake (unidades) <-> R$, nos dois sentidos — pra quem pensa em reais
// (a maioria das pessoas) não precisar fazer a conta de cabeça e errar
// (ex: digitar "0,38" tentando representar R$375, quando o certo é 0,375).
// Um lado nunca reescreve o outro em loop: só atualiza o campo OPOSTO ao
// que a pessoa está digitando, e alterar .value por código não dispara
// 'input' de novo.
function parseBRNumber(str) {
  const limpo = String(str || "").trim().replace(/[^\d,.-]/g, "");
  if (!limpo) return NaN;
  // último separador (, ou .) é o decimal; os anteriores são milhar
  const ultimaVirgula = limpo.lastIndexOf(",");
  const ultimoPonto = limpo.lastIndexOf(".");
  const posDecimal = Math.max(ultimaVirgula, ultimoPonto);
  let normalizado;
  if (posDecimal === -1) {
    normalizado = limpo;
  } else {
    normalizado = limpo.slice(0, posDecimal).replace(/[.,]/g, "") + "." + limpo.slice(posDecimal + 1);
  }
  return Number(normalizado);
}

function syncFromUnits(unitsId, reaisId) {
  const u = document.getElementById(unitsId);
  const r = document.getElementById(reaisId);
  if (!u || !r) return;
  const n = Number(u.value.replace(",", "."));
  if (!u.value.trim() || isNaN(n)) { r.value = ""; return; }
  const reais = n * (window.STAKE_BASE || 1000);
  r.value = reais.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function syncFromReais(reaisId, unitsId) {
  const r = document.getElementById(reaisId);
  const u = document.getElementById(unitsId);
  if (!r || !u) return;
  const n = parseBRNumber(r.value);
  if (!r.value.trim() || isNaN(n)) { u.value = ""; return; }
  const units = n / (window.STAKE_BASE || 1000);
  u.value = units.toFixed(4).replace(".", ",");
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

// ---------- Temas ----------
const THEMES = [
  { id: "light-default", label: "Padrão", group: "light", bg: "#eef1f6", sidebarBg: "#12151f", cardBg: "#ffffff", accent: "#6fa72e" },
  { id: "light-oceano", label: "Oceano", group: "light", bg: "#eef5f7", sidebarBg: "#0c2b3a", cardBg: "#ffffff", accent: "#1d7ea6" },
  { id: "light-terracota", label: "Terracota", group: "light", bg: "#faf3ea", sidebarBg: "#2b1d14", cardBg: "#fffaf3", accent: "#c8672f" },
  { id: "light-ameixa", label: "Ameixa", group: "light", bg: "#f5f1f8", sidebarBg: "#241b30", cardBg: "#ffffff", accent: "#7c4dab" },
  { id: "light-floresta", label: "Floresta", group: "light", bg: "#f3f1e9", sidebarBg: "#1b2b1e", cardBg: "#fdfcf7", accent: "#2f6b3a" },
  { id: "dark-default", label: "Padrão", group: "dark", bg: "#0f1626", sidebarBg: "#0a0f1e", cardBg: "#1a2338", accent: "#8bc34a" },
  { id: "dark-meianoite", label: "Meia-noite", group: "dark", bg: "#161326", sidebarBg: "#0f0c1d", cardBg: "#211c36", accent: "#9d6fe0" },
  { id: "dark-carvao", label: "Carvão", group: "dark", bg: "#14171c", sidebarBg: "#0d0f13", cardBg: "#1f2329", accent: "#6b93c9" },
  { id: "dark-cobre", label: "Cobre", group: "dark", bg: "#1c1512", sidebarBg: "#130d0b", cardBg: "#2a201b", accent: "#c97d4a" },
  { id: "dark-safira", label: "Safira", group: "dark", bg: "#0d1526", sidebarBg: "#080e1b", cardBg: "#17233d", accent: "#3b82f6" },
  { id: "dark-nebulosa", label: "Nebulosa", group: "neon", bg: "#0a0e1c", sidebarBg: "#06080f", cardBg: "#161a2e", accent: "#a855f7", gradient: "linear-gradient(135deg, #4f7df7 0%, #a855f7 55%, #ec4899 100%)" },
  { id: "dark-cyber", label: "Cyber", group: "neon", bg: "#071318", sidebarBg: "#04090c", cardBg: "#0e1f27", accent: "#22d3ee", gradient: "linear-gradient(135deg, #22d3ee 0%, #0ea5e9 55%, #6366f1 100%)" },
  { id: "dark-hacker", label: "Hacker", group: "neon", bg: "#050b07", sidebarBg: "#030502", cardBg: "#0e1c11", accent: "#39ff88", gradient: "linear-gradient(135deg, #a3ff5c 0%, #39ff88 55%, #10d68a 100%)" },
  { id: "dark-lava", label: "Lava", group: "neon", bg: "#170b06", sidebarBg: "#0f0503", cardBg: "#241209", accent: "#fb923c", gradient: "linear-gradient(135deg, #fbbf24 0%, #fb923c 55%, #f43f5e 100%)" },
  { id: "dark-fucsia", label: "Fúcsia", group: "neon", bg: "#170a14", sidebarBg: "#0f050d", cardBg: "#251020", accent: "#ec4899", gradient: "linear-gradient(135deg, #f472b6 0%, #ec4899 50%, #db2777 100%)" },
];

let CURRENT_THEME = "dark-nebulosa";

function applyTheme(themeId) {
  const theme = THEMES.find(t => t.id === themeId) || THEMES[0];
  CURRENT_THEME = theme.id;
  document.body.dataset.theme = theme.id;
  document.body.classList.toggle("theme-dark", theme.group !== "light");
  try { localStorage.setItem("painel_theme", theme.id); } catch (e) {}
  renderThemeGrid();
  if (ALL_BETS.length) renderAll(); // recria o gráfico com as cores certas
}

function renderThemeGrid() {
  const lightGrid = document.getElementById("theme-grid-light");
  const darkGrid = document.getElementById("theme-grid-dark");
  const neonGrid = document.getElementById("theme-grid-neon");
  if (!lightGrid || !darkGrid || !neonGrid) return;
  const buildSwatch = (t) => `
    <button class="theme-swatch ${t.id === CURRENT_THEME ? "active" : ""}" onclick="applyTheme('${t.id}')">
      <div class="theme-swatch-preview" style="background:${t.bg}">
        <div class="sidebar-strip" style="background:${t.sidebarBg}"></div>
        <div class="content-strip"><span class="accent-dot" style="background:${t.gradient || t.accent}"></span></div>
      </div>
      <div class="theme-swatch-name">${t.label}</div>
    </button>
  `;
  lightGrid.innerHTML = THEMES.filter(t => t.group === "light").map(buildSwatch).join("");
  darkGrid.innerHTML = THEMES.filter(t => t.group === "dark").map(buildSwatch).join("");
  neonGrid.innerHTML = THEMES.filter(t => t.group === "neon").map(buildSwatch).join("");
}

// ---------- Fontes ----------
const FONTS = [
  { id: "montserrat", label: "Montserrat", stack: `"Montserrat", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif` },
  { id: "inter", label: "Inter", stack: `"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif` },
  { id: "work-sans", label: "Work Sans", stack: `"Work Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif` },
  { id: "ibm-plex-sans", label: "IBM Plex Sans", stack: `"IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif` },
  { id: "source-sans-3", label: "Source Sans 3", stack: `"Source Sans 3", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif` },
  { id: "dm-sans", label: "DM Sans", stack: `"DM Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif` },
  { id: "manrope", label: "Manrope", stack: `"Manrope", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif` },
  { id: "outfit", label: "Outfit", stack: `"Outfit", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif` },
  { id: "sora", label: "Sora", stack: `"Sora", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif` },
  { id: "space-grotesk", label: "Space Grotesk", stack: `"Space Grotesk", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif` },
];

let CURRENT_FONT = "montserrat";

function applyFont(fontId) {
  const font = FONTS.find(f => f.id === fontId) || FONTS[0];
  CURRENT_FONT = font.id;
  document.documentElement.style.setProperty("--font-family", font.stack);
  try { localStorage.setItem("painel_font", font.id); } catch (e) {}
  renderFontGrid();
  if (ALL_BETS.length && chartInstance) renderAll(); // redesenha o gráfico com a fonte certa
}

function renderFontGrid() {
  const grid = document.getElementById("font-grid");
  if (!grid) return;
  grid.innerHTML = FONTS.map(f => `
    <button class="theme-swatch ${f.id === CURRENT_FONT ? "active" : ""}" onclick="applyFont('${f.id}')">
      <div class="theme-swatch-preview font-swatch-preview" style="font-family:${f.stack}">Aa</div>
      <div class="theme-swatch-name">${f.label}</div>
    </button>
  `).join("");
}

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
    renderCasaChips();
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
  if (!ACTIVE_MES || CURRENT_VIEW === "ranking" || CURRENT_VIEW === "bancas" || CURRENT_VIEW === "cadastro" || CURRENT_VIEW === "personalizacao") {
    bar.style.display = "none";
    return;
  }
  bar.style.display = "";

  const betsDoMes = ALL_BETS.filter(b => b.mes === ACTIVE_MES);
  const tipsters = [...new Set(betsDoMes.map(b => b.tipster).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" }));
  const container = document.getElementById("tipster-chips");
  container.innerHTML = "";

  const chipTodos = document.createElement("button");
  chipTodos.className = "chip chip-all" + (ACTIVE_TIPSTER ? "" : " active");
  chipTodos.textContent = "Todos";
  chipTodos.onclick = () => {
    if (!ACTIVE_TIPSTER) return;
    ACTIVE_TIPSTER = null;
    renderChips();
    renderAll();
  };
  container.appendChild(chipTodos);

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
  const select = document.getElementById("tipster-select");
  select.innerHTML = `<option value="">Todos os tipsters</option>` +
    tipsters.map(t => `<option value="${esc(t)}" ${ACTIVE_TIPSTER === t ? "selected" : ""}>${esc(t)}</option>`).join("");
}

document.getElementById("tipster-select").addEventListener("change", (e) => {
  ACTIVE_TIPSTER = e.target.value || null;
  renderChips();
  renderAll();
});

// ---------- Chips de casa (só aparecem com um mês selecionado) ----------
function renderCasaChips() {
  const bar = document.getElementById("casa-filter-bar");
  if (!ACTIVE_MES || CURRENT_VIEW === "ranking" || CURRENT_VIEW === "bancas" || CURRENT_VIEW === "cadastro" || CURRENT_VIEW === "personalizacao") {
    bar.style.display = "none";
    return;
  }
  bar.style.display = "";

  const betsDoMes = ALL_BETS.filter(b => b.mes === ACTIVE_MES);
  const casas = [...new Set(betsDoMes.map(b => b.casa).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" }));
  const container = document.getElementById("casa-chips");
  container.innerHTML = "";

  const chipTodos = document.createElement("button");
  chipTodos.className = "chip chip-all" + (ACTIVE_CASA ? "" : " active");
  chipTodos.textContent = "Todas";
  chipTodos.onclick = () => {
    if (!ACTIVE_CASA) return;
    ACTIVE_CASA = null;
    renderCasaChips();
    renderAll();
  };
  container.appendChild(chipTodos);

  casas.forEach(c => {
    const chip = document.createElement("button");
    chip.className = "chip" + (ACTIVE_CASA === c ? " active" : "");
    chip.textContent = c;
    chip.onclick = () => {
      ACTIVE_CASA = (ACTIVE_CASA === c) ? null : c;
      renderCasaChips();
      renderAll();
    };
    container.appendChild(chip);
  });

  const select = document.getElementById("casa-select");
  select.innerHTML = `<option value="">Todas as casas</option>` +
    casas.map(c => `<option value="${esc(c)}" ${ACTIVE_CASA === c ? "selected" : ""}>${esc(c)}</option>`).join("");
}

document.getElementById("casa-select").addEventListener("change", (e) => {
  ACTIVE_CASA = e.target.value || null;
  renderCasaChips();
  renderAll();
});

// ---------- Chips de mês ----------
function renderMesChips() {
  // ordem cronológica, do mês mais recente pro mais antigo
  const meses = sortMeses([...new Set(ALL_BETS.map(b => b.mes).filter(Boolean))]);
  const container = document.getElementById("mes-chips");
  container.innerHTML = "";

  const chipTodos = document.createElement("button");
  chipTodos.className = "chip chip-all" + (ACTIVE_MES ? "" : " active");
  chipTodos.textContent = "Todos";
  chipTodos.onclick = () => {
    if (!ACTIVE_MES) return;
    ACTIVE_MES = null;
    ACTIVE_TIPSTER = null;
    ACTIVE_CASA = null;
    renderMesChips();
    renderChips();
    renderCasaChips();
    renderAll();
  };
  container.appendChild(chipTodos);

  meses.forEach(m => {
    const chip = document.createElement("button");
    chip.className = "chip" + (ACTIVE_MES === m ? " active" : "");
    chip.textContent = formatMesLabel(m);
    chip.onclick = () => {
      ACTIVE_MES = (ACTIVE_MES === m) ? null : m;
      ACTIVE_TIPSTER = null; // a lista de tipsters muda de mês pra mês
      ACTIVE_CASA = null;
      renderMesChips();
      renderChips();
      renderCasaChips();
      renderAll();
    };
    container.appendChild(chip);
  });

  const select = document.getElementById("mes-select");
  select.innerHTML = `<option value="">Todos os meses</option>` +
    meses.map(m => `<option value="${esc(m)}" ${ACTIVE_MES === m ? "selected" : ""}>${esc(formatMesLabel(m))}</option>`).join("");
}

document.getElementById("mes-select").addEventListener("change", (e) => {
  ACTIVE_MES = e.target.value || null;
  ACTIVE_TIPSTER = null;
  ACTIVE_CASA = null;
  renderMesChips();
  renderChips();
  renderCasaChips();
  renderAll();
});

// ---------- Barra "Filtros ativos" ----------
function renderActiveFiltersBar() {
  atualizarResumoFiltrosMobile();
  const bar = document.getElementById("active-filters-bar");
  const container = document.getElementById("active-filter-chips");
  const filtros = [];
  if (ACTIVE_MES) filtros.push({ label: `Mês: ${formatMesLabel(ACTIVE_MES)}`, clear: () => { ACTIVE_MES = null; ACTIVE_TIPSTER = null; ACTIVE_CASA = null; } });
  if (ACTIVE_TIPSTER) filtros.push({ label: `Tipster: ${ACTIVE_TIPSTER}`, clear: () => { ACTIVE_TIPSTER = null; } });
  if (ACTIVE_CASA) filtros.push({ label: `Casa: ${ACTIVE_CASA}`, clear: () => { ACTIVE_CASA = null; } });

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
      renderCasaChips();
      renderActiveFiltersBar();
      renderAll();
    };
    container.appendChild(chip);
  });
}

document.getElementById("clear-all-filters").addEventListener("click", () => {
  ACTIVE_MES = null;
  ACTIVE_TIPSTER = null;
  ACTIVE_CASA = null;
  renderMesChips();
  renderChips();
  renderCasaChips();
  renderAll();
});

// ---------- Gaveta de filtros no mobile ----------
// Resume Mês/Tipster/Casa ativos no próprio botão, pra não precisar da caixa
// "Filtros ativos" separada (que só duplicava a mesma informação).
function atualizarResumoFiltrosMobile() {
  const label = document.getElementById("mobile-filters-toggle-label");
  if (!label) return;
  const partes = [];
  if (ACTIVE_MES) partes.push(formatMesLabel(ACTIVE_MES));
  if (ACTIVE_TIPSTER) partes.push(ACTIVE_TIPSTER);
  if (ACTIVE_CASA) partes.push(ACTIVE_CASA);
  label.textContent = partes.length ? partes.join(" · ") : "Filtros";
}

document.getElementById("mobile-filters-toggle").addEventListener("click", () => {
  document.getElementById("filters-row").classList.toggle("mobile-expanded");
  document.getElementById("mobile-filters-toggle").classList.toggle("expanded");
});

// ---------- Navegação entre visões ----------
function switchView(view) {
  fecharMenuMobile();
  CURRENT_VIEW = view;
  // o filtro de Mês (global, em cima de todas as views) não faz sentido em
  // Configurações nem Personalização — tema/fonte e cadastro de
  // tipster/casa não são coisas que mudam por mês. Esconde tanto a versão
  // desktop (os 3 dropdowns) quanto o botão "Filtros" do mobile.
  const semFiltroDeMes = view === "cadastro" || view === "personalizacao";
  document.getElementById("filters-row").style.display = semFiltroDeMes ? "none" : "";
  document.getElementById("mobile-filters-toggle").style.display = semFiltroDeMes ? "none" : "";
  ["geral", "historico", "ranking", "bancas", "cadastro", "personalizacao"].forEach(v => {
    document.getElementById(`view-${v}`).style.display = (v === view) ? "" : "none";
  });
  document.getElementById("nav-geral").classList.toggle("active", view === "geral");
  document.getElementById("nav-historico").classList.toggle("active", view === "historico");
  document.getElementById("nav-ranking").classList.toggle("active", view === "ranking");
  document.getElementById("nav-bancas").classList.toggle("active", view === "bancas");
  document.getElementById("nav-cadastro").classList.toggle("active", view === "cadastro");
  document.getElementById("nav-personalizacao").classList.toggle("active", view === "personalizacao");

  renderChips();
  renderCasaChips();

  // corrige um bug de largura no Safari do iPhone: volta a rolagem da
  // página e das tabelas pro início, e força o gráfico a recalcular o
  // tamanho (senão às vezes ele "esquece" a largura certa depois de ficar
  // escondido numa troca de aba)
  window.scrollTo(0, 0);
  document.querySelectorAll(".table-card").forEach(el => { el.scrollLeft = 0; });
  if (view === "geral" && chartInstance) {
    setTimeout(() => chartInstance.resize(), 50);
  }

  if (view === "historico") renderHistorico();
  if (view === "ranking") renderRanking();
  if (view === "bancas") loadBancas();
  if (view === "personalizacao") { renderThemeGrid(); renderFontGrid(); }
  if (view === "cadastro") { renderTipstersList(); renderCasasList(); }
}

// ---------- Menu mobile (hambúrguer) ----------
function abrirMenuMobile() {
  document.getElementById("sidebar").classList.add("mobile-open");
  document.getElementById("mobile-menu-backdrop").classList.add("visible");
}
function fecharMenuMobile() {
  document.getElementById("sidebar").classList.remove("mobile-open");
  document.getElementById("mobile-menu-backdrop").classList.remove("visible");
}
document.getElementById("mobile-menu-btn").addEventListener("click", abrirMenuMobile);
document.getElementById("mobile-menu-backdrop").addEventListener("click", fecharMenuMobile);
document.getElementById("mobile-topbar-wordmark").addEventListener("click", () => switchView("geral"));

document.getElementById("nav-geral").addEventListener("click", () => switchView("geral"));
document.getElementById("brand-home").addEventListener("click", () => switchView("geral"));

// ---------- Perfil (nome + foto) ----------
// Guardado no navegador (mesmo mecanismo de tema/fonte) — não existe conta
// de usuário nesse app ainda, é um painel de uso pessoal.
function iniciaisDoNome(nome) {
  const partes = (nome || "").trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return "?";
  const primeira = partes[0][0];
  const ultima = partes.length > 1 ? partes[partes.length - 1][0] : "";
  return (primeira + ultima).toUpperCase();
}

function carregarPerfil() {
  let nome = "Luís Vaccari";
  let foto = null;
  try {
    nome = localStorage.getItem("painel_nome") || nome;
    foto = localStorage.getItem("painel_foto") || null;
  } catch (e) {}
  return { nome, foto };
}

function aplicarPerfilNaTela() {
  const { nome, foto } = carregarPerfil();
  document.getElementById("brand-name").textContent = nome;
  const mark = document.getElementById("brand-mark");
  if (foto) {
    mark.style.backgroundImage = `url(${foto})`;
    mark.textContent = "";
  } else {
    mark.style.backgroundImage = "";
    mark.textContent = iniciaisDoNome(nome);
  }
}

// Redimensiona e recorta a foto num quadrado pequeno antes de guardar — uma
// foto de celular sem tratar pesaria vários MB em data-URL, o que é
// desnecessário pra um avatar de 34px e arriscado pro limite do localStorage.
function processarFotoPerfil(file, callback) {
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.onload = () => {
    const lado = Math.min(img.width, img.height);
    const sx = (img.width - lado) / 2;
    const sy = (img.height - lado) / 2;
    const TAMANHO = 160;
    const canvas = document.createElement("canvas");
    canvas.width = TAMANHO;
    canvas.height = TAMANHO;
    canvas.getContext("2d").drawImage(img, sx, sy, lado, lado, 0, 0, TAMANHO, TAMANHO);
    URL.revokeObjectURL(url);
    callback(canvas.toDataURL("image/jpeg", 0.85));
  };
  img.src = url;
}

let PROFILE_EDIT_FOTO = undefined; // undefined = não mexeu, null = removida, string = nova

function abrirEdicaoPerfil(e) {
  e.stopPropagation(); // não deixa o clique "vazar" pro brand-home (que trocaria de tela)
  const { nome, foto } = carregarPerfil();
  document.getElementById("profile-edit-name-input").value = nome;
  PROFILE_EDIT_FOTO = undefined;
  atualizarPreviewEdicaoPerfil(foto);
  document.getElementById("profile-edit-overlay").style.display = "flex";
}

function atualizarPreviewEdicaoPerfil(foto) {
  const preview = document.getElementById("profile-edit-avatar-preview");
  const nomeAtual = document.getElementById("profile-edit-name-input").value;
  if (foto) {
    preview.style.backgroundImage = `url(${foto})`;
    preview.textContent = "";
  } else {
    preview.style.backgroundImage = "";
    preview.textContent = iniciaisDoNome(nomeAtual);
  }
  document.getElementById("profile-edit-photo-remove").style.display = foto ? "inline" : "none";
}

document.getElementById("brand-edit-btn").addEventListener("click", abrirEdicaoPerfil);

document.getElementById("profile-edit-name-input").addEventListener("input", () => {
  const fotoAtual = PROFILE_EDIT_FOTO !== undefined ? PROFILE_EDIT_FOTO : carregarPerfil().foto;
  atualizarPreviewEdicaoPerfil(fotoAtual);
});

document.getElementById("profile-edit-photo-btn").addEventListener("click", () => {
  document.getElementById("profile-edit-photo-input").click();
});

document.getElementById("profile-edit-photo-input").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  processarFotoPerfil(file, (dataUrl) => {
    PROFILE_EDIT_FOTO = dataUrl;
    atualizarPreviewEdicaoPerfil(dataUrl);
  });
});

document.getElementById("profile-edit-photo-remove").addEventListener("click", () => {
  PROFILE_EDIT_FOTO = null;
  atualizarPreviewEdicaoPerfil(null);
});

document.getElementById("profile-edit-cancel").addEventListener("click", () => {
  document.getElementById("profile-edit-overlay").style.display = "none";
});
document.getElementById("profile-edit-overlay").addEventListener("click", (e) => {
  if (e.target.id === "profile-edit-overlay") document.getElementById("profile-edit-overlay").style.display = "none";
});

document.getElementById("profile-edit-save").addEventListener("click", () => {
  const nome = document.getElementById("profile-edit-name-input").value.trim() || "Sem nome";
  try {
    localStorage.setItem("painel_nome", nome);
    if (PROFILE_EDIT_FOTO === null) {
      localStorage.removeItem("painel_foto");
    } else if (PROFILE_EDIT_FOTO !== undefined) {
      localStorage.setItem("painel_foto", PROFILE_EDIT_FOTO);
    }
  } catch (e) {}
  document.getElementById("profile-edit-overlay").style.display = "none";
  aplicarPerfilNaTela();
});

aplicarPerfilNaTela();

document.getElementById("nav-historico").addEventListener("click", () => {
  ONLY_PENDING = false;
  ONLY_PENDING_TODAY = false;
  ONLY_PENDING_FUTURE = false;
  ONLY_TODAY = true;
  ONLY_YESTERDAY = false;
  ACTIVE_TIPSTER = null;
  ACTIVE_CASA = null;
  SORT_STATE.hist = { key: "data_hora_sort", dir: -1 }; // mais tarde pro mais cedo
  clearQuickFilterChips();
  document.getElementById("filter-today").classList.add("active");
  switchView("historico");
});
document.getElementById("nav-ranking").addEventListener("click", () => switchView("ranking"));
document.getElementById("nav-bancas").addEventListener("click", () => switchView("bancas"));
document.getElementById("nav-cadastro").addEventListener("click", () => switchView("cadastro"));
document.getElementById("nav-personalizacao").addEventListener("click", () => switchView("personalizacao"));

document.getElementById("card-aberto").addEventListener("click", () => {
  // "Em aberto" mostra TODAS as pendentes (hoje + futuro misturadas) — pra
  // ver só um lado, usa os chips "Pend. hoje"/"Pend. futuro" na Histórico.
  ONLY_PENDING = true;
  ONLY_TODAY = false;
  ONLY_YESTERDAY = false;
  ONLY_PENDING_TODAY = false;
  ONLY_PENDING_FUTURE = false;
  EDITING_IDX = null;
  switchView("historico");
  clearQuickFilterChips();
});

document.getElementById("clear-pending-filter").addEventListener("click", () => {
  ONLY_PENDING = false;
  ONLY_PENDING_TODAY = false;
  ONLY_PENDING_FUTURE = false;
  clearQuickFilterChips();
  renderHistorico();
});

// Chips "Hoje" / "Ontem" / "Pend. hoje" / "Pend. futuro" — mutuamente
// exclusivos entre si (clicar num já ativo desliga; clicar noutro troca).
const QUICK_FILTER_CHIPS = {
  today: "filter-today",
  yesterday: "filter-yesterday",
  pendingToday: "filter-pending-today",
  pendingFuture: "filter-pending-future",
};

function clearQuickFilterChips() {
  Object.values(QUICK_FILTER_CHIPS).forEach(id => {
    document.getElementById(id).classList.remove("active");
  });
}

function toggleQuickFilter(which) {
  const estavaAtivo =
    (which === "today" && ONLY_TODAY) ||
    (which === "yesterday" && ONLY_YESTERDAY) ||
    (which === "pendingToday" && ONLY_PENDING_TODAY) ||
    (which === "pendingFuture" && ONLY_PENDING_FUTURE);

  ONLY_TODAY = false;
  ONLY_YESTERDAY = false;
  ONLY_PENDING = false;
  ONLY_PENDING_TODAY = false;
  ONLY_PENDING_FUTURE = false;
  clearQuickFilterChips();

  if (!estavaAtivo) {
    if (which === "today") ONLY_TODAY = true;
    else if (which === "yesterday") ONLY_YESTERDAY = true;
    else if (which === "pendingToday") ONLY_PENDING_TODAY = true;
    else if (which === "pendingFuture") ONLY_PENDING_FUTURE = true;
    document.getElementById(QUICK_FILTER_CHIPS[which]).classList.add("active");
  }
  renderHistorico();
}

document.getElementById("filter-today").addEventListener("click", () => toggleQuickFilter("today"));
document.getElementById("filter-yesterday").addEventListener("click", () => toggleQuickFilter("yesterday"));
document.getElementById("filter-pending-today").addEventListener("click", () => toggleQuickFilter("pendingToday"));
document.getElementById("filter-pending-future").addEventListener("click", () => toggleQuickFilter("pendingFuture"));

// Busca por time/jogo no Histórico — filtra o texto da coluna Aposta
// ("Time A x Time B - Mercado"), sem acento e sem diferenciar maiúscula.
let SEARCH_DEBOUNCE_TIMER = null;
document.getElementById("hist-search-input").addEventListener("input", (e) => {
  const valor = e.target.value;
  document.getElementById("hist-search-clear").style.display = valor ? "flex" : "none";
  clearTimeout(SEARCH_DEBOUNCE_TIMER);
  SEARCH_DEBOUNCE_TIMER = setTimeout(() => {
    SEARCH_QUERY = valor.trim();
    renderHistorico();
  }, 250);
});
document.getElementById("hist-search-clear").addEventListener("click", () => {
  const input = document.getElementById("hist-search-input");
  input.value = "";
  input.focus();
  document.getElementById("hist-search-clear").style.display = "none";
  SEARCH_QUERY = "";
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
  casa: { key: null, dir: 1 },
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
  ["th-hist-data", "data_hora_sort"],
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
  ["th-banca-lucro", "lucro"],
];
const CASA_HEADERS = [
  ["th-casa-nome", "casa"],
  ["th-casa-apostas", "apostas"],
  ["th-casa-roi", "roi"],
  ["th-casa-lucro", "lucro"],
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

  // Cards e Tabela renderizam os dois ao mesmo tempo (só um fica visível),
  // então cada campo tem um id -tbl e um -card — aqui lê sempre do conjunto
  // que está realmente na tela, senão a edição pelo modo Tabela salvaria os
  // valores (não editados) do Cards por baixo, sem avisar nada.
  const suf = HIST_VIEW_MODE === "table" ? "tbl" : "card";
  const val = (campo) => document.getElementById(`edit-${campo}-${idx}-${suf}`).value;

  const updates = {
    data: val("data"),
    horario: val("horario"),
    casa: val("casa"),
    tipster: val("tipster"),
    aposta: val("aposta"),
    odd: val("odd"),
    stake: val("stake"),
    resultado: val("resultado"),
  };

  const anterior = { ...bet };
  bet.casa = updates.casa;
  bet.tipster = updates.tipster;
  bet.aposta = updates.aposta;
  bet.resultado = updates.resultado;
  bet.data = updates.data;
  bet.horario = updates.horario;
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
  // ordenar por horário só faz sentido dentro de um único dia — com o mês
  // inteiro visível, "mais cedo pra mais tarde" pularia de dia em dia sem
  // ajudar em nada. Se o filtro Hoje/Ontem foi desligado enquanto essa
  // ordenação estava ativa, volta pro padrão (mais recente primeiro).
  // "Pend. futuro" pode ter mais de uma data (dias diferentes) — mas
  // data_hora_sort já agrupa certo por data e depois por hora, então o botão
  // continua fazendo sentido mesmo aí, não só quando é um único dia.
  const filtroDeDataAtivo = ONLY_TODAY || ONLY_YESTERDAY || ONLY_PENDING_TODAY || ONLY_PENDING_FUTURE;
  if (SORT_STATE.hist.key === "data_hora_sort" && !filtroDeDataAtivo) {
    SORT_STATE.hist = { key: null, dir: 1 };
  }
  if (SORT_STATE.hist.key) {
    bets = applySort(bets, SORT_STATE.hist, (b, k) => b[k]);
  } else {
    bets.sort(compareRecentFirst);
  }

  CURRENT_HISTORICO_BETS = bets;

  const algumaPendenteAtiva = ONLY_PENDING || ONLY_PENDING_TODAY || ONLY_PENDING_FUTURE;
  document.getElementById("pending-banner").style.display = algumaPendenteAtiva ? "flex" : "none";
  if (algumaPendenteAtiva) {
    document.getElementById("pending-banner-text").textContent = ONLY_PENDING_TODAY
      ? "Mostrando só as apostas pendentes de hoje."
      : ONLY_PENDING_FUTURE
      ? "Mostrando só as apostas pendentes futuras."
      : "Mostrando só as apostas pendentes.";
  }

  renderBetsCards(bets);

  tbody.innerHTML = bets.map((b, idx) => {
    const uniClass = b.lucro_uni > 0 ? "positive" : b.lucro_uni < 0 ? "negative" : "";
    const editing = EDITING_IDX === idx;

    if (editing) {
      return `
        <tr>
          <td data-label="Data">
            <input class="edit-input small" id="edit-data-${idx}-tbl" value="${esc(b.data)}">
            <input class="edit-input small" id="edit-horario-${idx}-tbl" value="${esc(b.horario)}" placeholder="Horário" onblur="formatHorarioInput(this)">
          </td>
          <td data-label="Casa"><input class="edit-input" id="edit-casa-${idx}-tbl" value="${esc(b.casa)}"></td>
          <td data-label="Tipster"><input class="edit-input" id="edit-tipster-${idx}-tbl" value="${esc(b.tipster)}"></td>
          <td data-label="Aposta"><input class="edit-input" id="edit-aposta-${idx}-tbl" value="${esc(b.aposta)}"></td>
          <td data-label="Stake">
            <input class="edit-input small" id="edit-stake-${idx}-tbl" value="${esc(b.stake ? b.stake.toFixed(4).replace(".", ",") : "")}" oninput="syncFromUnits('edit-stake-${idx}-tbl', 'edit-stake-reais-${idx}-tbl')">
            <input class="stake-reais-input" id="edit-stake-reais-${idx}-tbl" placeholder="R$" oninput="syncFromReais('edit-stake-reais-${idx}-tbl', 'edit-stake-${idx}-tbl')">
          </td>
          <td data-label="Odd"><input class="edit-input small" id="edit-odd-${idx}-tbl" value="${esc(b.odd ? b.odd.toFixed(3).replace(".", ",") : "")}"></td>
          <td data-label="Resultado">
            <select class="edit-input" id="edit-resultado-${idx}-tbl">
              <option value="" ${!b.resultado ? "selected" : ""}>Pendente</option>
              <option value="Green" ${b.resultado === "Green" ? "selected" : ""}>Green</option>
              <option value="Red" ${b.resultado === "Red" ? "selected" : ""}>Red</option>
              <option value="Void" ${b.resultado === "Void" ? "selected" : ""}>Void</option>
            </select>
          </td>
          <td data-label="P/L">—</td>
          <td data-label="Ações">
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
        <td data-label="Data">${b.data || "—"}${b.horario ? ` <span class="hist-horario">${b.horario}</span>` : ""}</td>
        <td data-label="Casa">${casaBadgeHtml(b.casa)}</td>
        <td data-label="Tipster">${b.tipster || "—"}</td>
        <td data-label="Aposta">${b.aposta || "—"}</td>
        <td data-label="Stake">${b.stake ? fmtDual(b.stake, b.stake_reais, false) : "—"}</td>
        <td data-label="Odd">${b.odd ? `<b>${fmtOdd(b.odd)}</b>` : "—"}</td>
        <td data-label="Resultado">${resolvedCell}</td>
        <td data-label="P/L" class="uni-cell ${uniClass}">${isResolved(b) ? fmtDual(b.lucro_uni, b.lucro_reais, true) : "—"}</td>
        <td data-label="Ações">
          <div class="row-actions">
            <button class="row-action-btn" title="Editar" onclick="startEdit(${idx})">✎</button>
            ${rowMenuHtml(idx)}
          </div>
        </td>
      </tr>
    `;
  }).join("");

  if (EDITING_IDX !== null) {
    syncFromUnits(`edit-stake-${EDITING_IDX}-tbl`, `edit-stake-reais-${EDITING_IDX}-tbl`);
    syncFromUnits(`edit-stake-${EDITING_IDX}-card`, `edit-stake-reais-${EDITING_IDX}-card`);
  }
  syncSortByHorarioBtn();
}

// ---------- Menu "..." de excluir aposta (compartilhado entre card e tabela) ----------
function toggleRowMenu(menuId) {
  document.querySelectorAll(".row-menu-popover").forEach(p => {
    p.style.display = (p.id === menuId && p.style.display !== "block") ? "block" : "none";
  });
}

document.addEventListener("click", (e) => {
  if (!e.target.closest(".row-menu-wrap")) {
    document.querySelectorAll(".row-menu-popover").forEach(p => { p.style.display = "none"; });
  }
});

async function deleteBetByIndex(idx) {
  const bet = CURRENT_HISTORICO_BETS[idx];
  if (!bet) return;
  document.querySelectorAll(".row-menu-popover").forEach(p => { p.style.display = "none"; });
  if (!confirm("Excluir essa aposta? Essa ação não pode ser desfeita.")) return;

  try {
    const res = await fetch("/api/delete_bet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mes: bet.mes, row: bet.row }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Erro ao excluir");
    setTimeout(() => refreshMes(bet.mes), 400);
  } catch (err) {
    alert("Não consegui excluir: " + err.message);
  }
}

function rowMenuHtml(idx, btnClass) {
  const menuId = `row-menu-${idx}`;
  const cls = btnClass || "row-action-btn";
  return `
    <div class="row-menu-wrap">
      <button class="${cls}" title="Mais opções" onclick="toggleRowMenu('${menuId}')">⋯</button>
      <div class="row-menu-popover" id="${menuId}">
        <button onclick="deleteBetByIndex(${idx})">Excluir</button>
      </div>
    </div>
  `;
}

function currentBets() {
  let result = ALL_BETS;
  if (ACTIVE_TIPSTER) result = result.filter(b => b.tipster === ACTIVE_TIPSTER);
  if (ACTIVE_CASA) result = result.filter(b => b.casa === ACTIVE_CASA);
  if (ACTIVE_MES) result = result.filter(b => b.mes === ACTIVE_MES);
  return result;
}

// ---------- Visão em cards do Histórico ----------
let HIST_VIEW_MODE = "cards";

function setHistViewMode(mode) {
  HIST_VIEW_MODE = mode;
  document.getElementById("hist-view-cards-btn").classList.toggle("active", mode === "cards");
  document.getElementById("hist-view-table-btn").classList.toggle("active", mode === "table");
  document.getElementById("bets-cards-grid").style.display = mode === "cards" ? "grid" : "none";
  document.getElementById("hist-table-wrap").style.display = mode === "table" ? "" : "none";
}

document.getElementById("hist-view-cards-btn").addEventListener("click", () => setHistViewMode("cards"));
document.getElementById("hist-view-table-btn").addEventListener("click", () => setHistViewMode("table"));

// separa "Time x Time - Palpite" em { jogo, resto }; se não tiver " - ",
// devolve o texto inteiro como jogo, sem segunda linha
function splitJogoAposta(aposta) {
  if (!aposta) return { jogo: "—", resto: null };
  const idx = aposta.indexOf(" - ");
  if (idx === -1) return { jogo: aposta, resto: null };
  return { jogo: aposta.slice(0, idx), resto: aposta.slice(idx + 3) };
}

function resultHeaderClass(resultado) {
  const r = (resultado || "").toLowerCase();
  if (r === "green") return "result-green";
  if (r === "red") return "result-red";
  if (r === "void") return "result-void";
  return "result-pending";
}

function resultBadgeLabel(resultado) {
  const r = (resultado || "").toLowerCase();
  if (r === "green") return "Ganhou";
  if (r === "red") return "Perdeu";
  if (r === "void") return "Void";
  return "Pendente";
}

function editFromCard(idx) {
  startEdit(idx);
}

function renderBetsCards(bets) {
  const grid = document.getElementById("bets-cards-grid");
  if (!grid) return;

  if (!bets.length) {
    grid.innerHTML = `<div class="no-bets-msg">Nenhuma aposta nesse filtro ainda.</div>`;
    return;
  }

  grid.innerHTML = bets.map((b, idx) => {
    if (EDITING_IDX === idx) {
      return `
        <div class="bet-card bet-card-editing">
          <div class="bet-card-header">
            <input class="edit-input small" id="edit-stake-${idx}-card" value="${esc(b.stake ? b.stake.toFixed(4).replace(".", ",") : "")}" placeholder="Stake" oninput="syncFromUnits('edit-stake-${idx}-card', 'edit-stake-reais-${idx}-card')">
            <input class="stake-reais-input" id="edit-stake-reais-${idx}-card" placeholder="R$" oninput="syncFromReais('edit-stake-reais-${idx}-card', 'edit-stake-${idx}-card')">
            <input class="edit-input" id="edit-tipster-${idx}-card" value="${esc(b.tipster)}" placeholder="Tipster" style="flex:1;">
          </div>
          <div class="bet-card-body">
            <input class="edit-input" id="edit-aposta-${idx}-card" value="${esc(b.aposta)}" placeholder="Jogo - Aposta" style="margin-bottom:8px; width:100%;">
            <div style="display:flex; gap:8px;">
              <input class="edit-input small" id="edit-odd-${idx}-card" value="${esc(b.odd ? b.odd.toFixed(3).replace(".", ",") : "")}" placeholder="Odd">
              <select class="edit-input" id="edit-resultado-${idx}-card">
                <option value="" ${!b.resultado ? "selected" : ""}>Pendente</option>
                <option value="Green" ${b.resultado === "Green" ? "selected" : ""}>Green</option>
                <option value="Red" ${b.resultado === "Red" ? "selected" : ""}>Red</option>
                <option value="Void" ${b.resultado === "Void" ? "selected" : ""}>Void</option>
              </select>
            </div>
          </div>
          <div class="bet-card-footer">
            <div style="display:flex; gap:8px; flex:1;">
              <input class="edit-input" id="edit-casa-${idx}-card" value="${esc(b.casa)}" placeholder="Casa" style="flex:1;">
              <input class="edit-input small" id="edit-data-${idx}-card" value="${esc(b.data)}" placeholder="Data">
              <input class="edit-input small" id="edit-horario-${idx}-card" value="${esc(b.horario)}" placeholder="Horário" onblur="formatHorarioInput(this)">
            </div>
            <div class="row-actions">
              <button class="row-action-btn save" title="Salvar" onclick="saveEdit(${idx})">✓</button>
              <button class="row-action-btn cancel" title="Cancelar" onclick="cancelEdit()">✕</button>
            </div>
          </div>
        </div>
      `;
    }

    const { jogo, resto } = splitJogoAposta(b.aposta);
    const oddTxt = b.odd ? fmtOdd(b.odd) : "";
    const apostaLinha = resto
      ? `${resto}${oddTxt ? ` <b>@${oddTxt}</b>` : ""}`
      : (oddTxt ? `<b>@${oddTxt}</b>` : "");

    const plClass = b.lucro_uni > 0 ? "positive" : b.lucro_uni < 0 ? "negative" : "";
    const acoesEEditar = `
      <button class="bet-card-edit" title="Editar" onclick="editFromCard(${idx})">✎</button>
      ${rowMenuHtml(idx, "bet-card-menu-btn")}
    `;
    const rodapeDireita = isResolved(b)
      ? `<span class="bet-card-pl ${plClass}">${fmtDual(b.lucro_uni, b.lucro_reais, true)}</span>${acoesEEditar}`
      : `<div class="resolve-actions">
           <button class="resolve-btn green" title="Green" onclick="resolveBetByIndex(${idx}, 'Green')">✓</button>
           <button class="resolve-btn red" title="Red" onclick="resolveBetByIndex(${idx}, 'Red')">✕</button>
           <button class="resolve-btn void" title="Void" onclick="resolveBetByIndex(${idx}, 'Void')">–</button>
         </div>${acoesEEditar}`;

    const key = cardKey(b);
    const collapsedClass = COLLAPSED_CARDS.has(key) ? " collapsed" : "";

    return `
      <div class="bet-card${collapsedClass}">
        <div class="bet-card-header" onclick="toggleCardCollapse(event, '${escJs(key)}')">
          <span class="bet-card-title">${b.stake ? fmtDual(b.stake, b.stake_reais, false) : "—"} - ${b.tipster || "—"}</span>
          <span class="bet-card-header-right">
            <span class="bet-card-badge ${resultHeaderClass(b.resultado)}">${resultBadgeLabel(b.resultado)}</span>
            <span class="bet-card-chevron">▾</span>
          </span>
        </div>
        <div class="bet-card-body">
          <div class="bet-card-jogo">${jogo}</div>
          ${apostaLinha ? `<div class="bet-card-aposta">${apostaLinha}</div>` : ""}
        </div>
        <div class="bet-card-footer">
          <span class="bet-card-footer-left">${casaBadgeHtml(b.casa)}<span class="bet-card-data">· ${b.data || "—"}${b.horario ? ` ${b.horario}` : ""}</span></span>
          <div class="bet-card-footer-right">${rodapeDireita}</div>
        </div>
      </div>
    `;
  }).join("");
}

// usado só na tabela do Histórico — soma os filtros rápidos (pendentes,
// hoje, ontem) por cima do filtro de tipster/mês, sem afetar os cards/gráfico
function historicoBets() {
  // Um filtro de dia (Hoje/Ontem/Pend.hoje/Pend.futuro) é mais específico
  // que o mês selecionado — se os dois brigassem (mês de agosto + "hoje" é
  // setembro), sobraria 0 resultado. Em vez de apagar o mês globalmente
  // (isso quebraria a Visão geral ao voltar pra lá), só ignora o filtro de
  // mês AQUI, localmente, sem mexer no ACTIVE_MES de verdade.
  const diaFiltroAtivo = ONLY_TODAY || ONLY_YESTERDAY || ONLY_PENDING_TODAY || ONLY_PENDING_FUTURE;
  let result = diaFiltroAtivo
    ? ALL_BETS.filter(b => (!ACTIVE_TIPSTER || b.tipster === ACTIVE_TIPSTER) && (!ACTIVE_CASA || b.casa === ACTIVE_CASA))
    : currentBets();
  if (ONLY_PENDING) result = result.filter(b => !isResolved(b));
  if (ONLY_TODAY) result = result.filter(b => b.data_iso === todayISO());
  if (ONLY_YESTERDAY) result = result.filter(b => b.data_iso === yesterdayISO());
  if (ONLY_PENDING_TODAY) result = result.filter(b => !isResolved(b) && b.data_iso === todayISO());
  if (ONLY_PENDING_FUTURE) result = result.filter(b => !isResolved(b) && b.data_iso && b.data_iso > todayISO());
  if (SEARCH_QUERY) {
    const alvo = stripAcentos(SEARCH_QUERY).toLowerCase();
    result = result.filter(b => stripAcentos(b.aposta || "").toLowerCase().includes(alvo));
  }
  return result;
}

// ---------- Modal "Nova aposta" ----------
function populateNewBetMesOptions() {
  const meses = sortMeses([...new Set(ALL_BETS.map(b => b.mes).filter(Boolean))]);
  const optionsHtml = meses.map(m => `<option value="${esc(m)}">${esc(formatMesLabel(m))}</option>`).join("");

  [document.getElementById("new-bet-mes"), document.getElementById("new-bet-print-mes")].forEach(select => {
    const atual = select.value;
    select.innerHTML = optionsHtml;
    if (ACTIVE_MES && meses.includes(ACTIVE_MES)) {
      select.value = ACTIVE_MES;
    } else if (meses.includes(atual)) {
      select.value = atual;
    }
  });
}

function populateNewBetTipsterOptions() {
  const select = document.getElementById("new-bet-tipster");
  if (!select) return;
  const mesEscolhido = document.getElementById("new-bet-mes").value;
  const anterior = select.value;

  const doMes = ALL_BETS.filter(b => !mesEscolhido || b.mes === mesEscolhido)
    .map(b => (b.tipster || "").trim())
    .filter(Boolean);

  const statusPorNome = {};
  TIPSTERS_REGISTRY.forEach(t => { statusPorNome[t.nome.toLowerCase()] = t.status; });
  const doRegistroAtivos = TIPSTERS_REGISTRY.filter(t => t.status === "Ativo").map(t => t.nome);

  const tipsters = [...new Set([...doMes, ...doRegistroAtivos])]
    .filter(nome => statusPorNome[nome.toLowerCase()] !== "Inativo")
    .sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" }));

  select.innerHTML = `<option value="">Sem tipster</option>` +
    tipsters.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join("");
  if (tipsters.includes(anterior)) select.value = anterior;
}

// Chips de atalho pros tipsters do mês na aba "Por print" — clicar preenche
// o campo Tipster sozinho; ainda dá pra digitar livremente (inclusive
// "somar"/"duplicar", que continuam funcionando como comando nesse campo).
function renderPrintTipsterChips() {
  const container = document.getElementById("print-tipster-chips");
  if (!container) return;
  const mesEscolhido = document.getElementById("new-bet-print-mes").value;

  // nomes que já apareceram em apostas do mês...
  const doMes = ALL_BETS.filter(b => !mesEscolhido || b.mes === mesEscolhido)
    .map(b => (b.tipster || "").trim())
    .filter(Boolean);

  // ...unidos com quem está Ativo no cadastro (Configurações > Tipsters),
  // mesmo sem nenhuma aposta ainda — e qualquer um marcado Inativo lá some
  // do atalho, mesmo que já tenha aposta esse mês.
  const statusPorNome = {};
  TIPSTERS_REGISTRY.forEach(t => { statusPorNome[t.nome.toLowerCase()] = t.status; });
  const doRegistroAtivos = TIPSTERS_REGISTRY.filter(t => t.status === "Ativo").map(t => t.nome);

  const tipsters = [...new Set([...doMes, ...doRegistroAtivos])]
    .filter(nome => statusPorNome[nome.toLowerCase()] !== "Inativo")
    .sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" }));

  const valorAtual = document.getElementById("new-bet-print-caption").value.trim();
  container.innerHTML = tipsters.map(t => `
    <button type="button" class="chip print-tipster-chip${t === valorAtual ? " active" : ""}">${esc(t)}</button>
  `).join("");

  container.querySelectorAll(".print-tipster-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      const input = document.getElementById("new-bet-print-caption");
      const jaEstavaAtivo = chip.classList.contains("active");
      input.value = jaEstavaAtivo ? "" : chip.textContent;
      renderPrintTipsterChips();
      input.focus();
    });
  });
}
document.getElementById("new-bet-print-mes").addEventListener("change", renderPrintTipsterChips);
document.getElementById("new-bet-print-caption").addEventListener("input", () => {
  document.querySelectorAll(".print-tipster-chip").forEach(chip => {
    chip.classList.toggle("active", chip.textContent === document.getElementById("new-bet-print-caption").value.trim());
  });
});

function setNewBetTipo(tipo) {
  NEW_BET_TIPO = (NEW_BET_TIPO === tipo) ? "" : tipo;
  document.getElementById("new-bet-tipo-pre").classList.toggle("active", NEW_BET_TIPO === "Pré");
  document.getElementById("new-bet-tipo-live").classList.toggle("active", NEW_BET_TIPO === "Live");
}

document.getElementById("new-bet-mes").addEventListener("change", populateNewBetTipsterOptions);
document.getElementById("new-bet-tipo-pre").addEventListener("click", () => setNewBetTipo("Pré"));
document.getElementById("new-bet-tipo-live").addEventListener("click", () => setNewBetTipo("Live"));

function openNewBetModal() {
  populateNewBetMesOptions();
  populateNewBetTipsterOptions();
  const hoje = new Date();
  const dd = String(hoje.getDate()).padStart(2, "0");
  const mm = String(hoje.getMonth() + 1).padStart(2, "0");
  document.getElementById("new-bet-data").value = `${dd}/${mm}/${hoje.getFullYear()}`;
  document.getElementById("new-bet-horario").value = "";
  document.getElementById("new-bet-casa").value = "";
  document.getElementById("new-bet-tipster").value = "";
  NEW_BET_TIPO = "";
  setNewBetTipo("");
  document.getElementById("new-bet-aposta").value = "";
  document.getElementById("new-bet-mercado").value = "";
  document.getElementById("new-bet-odd").value = "";
  document.getElementById("new-bet-stake").value = "0,75";
  syncFromUnits("new-bet-stake", "new-bet-stake-reais");
  document.getElementById("new-bet-resultado").value = "";
  document.getElementById("new-bet-print-file").value = "";
  document.getElementById("new-bet-print-data").value = "";
  document.getElementById("new-bet-print-caption").value = "";
  renderPrintTipsterChips();
  document.getElementById("new-bet-print-feedback").innerHTML = "";
  document.getElementById("new-bet-print-feedback").className = "";
  PASTED_IMAGE = null;
  document.getElementById("new-bet-paste-preview").innerHTML = "";
  document.getElementById("new-bet-paste-zone").classList.remove("has-image");
  document.getElementById("print-loading-bar").style.display = "none";
  document.getElementById("new-bet-print-send").disabled = false;
  document.getElementById("new-bet-print-send").style.display = "";
  setNewBetMode("print");
  document.getElementById("new-bet-overlay").style.display = "flex";
}

// ---------- Colar imagem copiada (Ctrl+V) no formulário de print ----------
let PASTED_IMAGE = null;

document.addEventListener("paste", (e) => {
  const printForm = document.getElementById("new-bet-print-form");
  if (!printForm || printForm.style.display === "none") return;
  const items = e.clipboardData ? e.clipboardData.items : [];
  for (const item of items) {
    if (item.type.startsWith("image/")) {
      const file = item.getAsFile();
      PASTED_IMAGE = file;
      document.getElementById("new-bet-print-file").value = "";
      const url = URL.createObjectURL(file);
      document.getElementById("new-bet-paste-preview").innerHTML = `<img src="${url}" alt="Print colado">`;
      document.getElementById("new-bet-paste-zone").classList.add("has-image");
      e.preventDefault();
      return;
    }
  }
});

// se escolher um arquivo pelo botão, isso tem prioridade sobre o que foi colado antes
document.getElementById("new-bet-print-file").addEventListener("change", () => {
  PASTED_IMAGE = null;
  document.getElementById("new-bet-paste-preview").innerHTML = "";
  document.getElementById("new-bet-paste-zone").classList.remove("has-image");
});

function setNewBetMode(mode) {
  document.getElementById("new-bet-mode-manual").classList.toggle("active", mode === "manual");
  document.getElementById("new-bet-mode-print").classList.toggle("active", mode === "print");
  document.getElementById("new-bet-manual-form").style.display = mode === "manual" ? "" : "none";
  document.getElementById("new-bet-print-form").style.display = mode === "print" ? "" : "none";
}

document.getElementById("new-bet-mode-manual").addEventListener("click", () => setNewBetMode("manual"));
document.getElementById("new-bet-mode-print").addEventListener("click", () => setNewBetMode("print"));
document.getElementById("new-bet-print-cancel").addEventListener("click", closeNewBetModal);

function closeNewBetModal() {
  document.getElementById("new-bet-overlay").style.display = "none";
}

document.getElementById("new-bet-btn").addEventListener("click", openNewBetModal);
document.getElementById("new-bet-btn-mobile").addEventListener("click", openNewBetModal);
document.getElementById("new-bet-cancel").addEventListener("click", closeNewBetModal);
document.getElementById("new-bet-close-x").addEventListener("click", closeNewBetModal);
document.getElementById("new-bet-overlay").addEventListener("click", (e) => {
  if (e.target.id === "new-bet-overlay") closeNewBetModal();
});

document.getElementById("new-bet-save").addEventListener("click", async () => {
  const mes = document.getElementById("new-bet-mes").value;
  const fields = {
    data: document.getElementById("new-bet-data").value,
    horario: document.getElementById("new-bet-horario").value,
    casa: document.getElementById("new-bet-casa").value,
    tipster: document.getElementById("new-bet-tipster").value,
    aposta: document.getElementById("new-bet-aposta").value,
    mercado: document.getElementById("new-bet-mercado").value,
    tipo: NEW_BET_TIPO,
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

// ---------- Nova aposta por print (manda pro bot processar) ----------
function setPrintFeedback(html, cls) {
  const el = document.getElementById("new-bet-print-feedback");
  el.innerHTML = html;
  el.className = cls || "";
}

function showPrintLoading(show) {
  document.getElementById("print-loading-bar").style.display = show ? "block" : "none";
}

function handlePrintResult(result, mes) {
  showPrintLoading(false);
  const sendBtn = document.getElementById("new-bet-print-send");

  if (result.status === "ok") {
    const linhasHtml = "✅ " + (result.linhas || []).join("<br>✅ ");
    let pendentes = (result.registros || []).filter(r => r.horario_pendente);

    // se o tipster desse print é só Live (nem Pré, nem "Pré + Live"), o
    // horário nunca significa "hora do jogo" — significa "hora que a
    // aposta foi feita", que já é agora mesmo. Não faz sentido perguntar;
    // preenche direto com a hora atual, igual o bot já faz sozinho pro
    // Telegram com os tipsters de tipo fixo.
    if (pendentes.length) {
      const nomeTipsterPrint = document.getElementById("new-bet-print-caption").value.trim();
      const infoTipster = TIPSTERS_REGISTRY.find(t => t.nome.toLowerCase() === nomeTipsterPrint.toLowerCase());
      if (infoTipster && infoTipster.tipo === "Live") {
        const agora = horaAtualHHMM();
        Promise.all(pendentes.map(p => fetch("/api/update_bet", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mes, row: p.row, updates: { horario: agora } }),
        }))).then(() => refreshMes(mes));
        pendentes = [];
      }
    }

    if (!pendentes.length) {
      setPrintFeedback(linhasHtml);
      sendBtn.disabled = true;
      setTimeout(() => {
        refreshMes(mes);
        closeNewBetModal();
      }, 1600);
      return;
    }

    // uma ou mais apostas ficaram sem horário (ex: BetBra, ou a IA não
    // conseguiu ler com confiança) — pede antes de fechar a janela, em vez
    // de fechar direto e depender de editar cada linha depois.
    sendBtn.style.display = "none";
    renderHorarioPendenteForm(mes, pendentes, linhasHtml);
    return;
  }

  if (result.status === "no_bets_found") {
    sendBtn.disabled = false;
    setPrintFeedback("Não consegui identificar nenhuma aposta nesse print. Tenta um print mais nítido.", "error");
  } else if (result.status === "waiting_somar") {
    sendBtn.disabled = false;
    setPrintFeedback(result.message);
  } else if (result.status === "ambiguous_casa") {
    sendBtn.disabled = false;
    const botoes = result.options.map(op =>
      `<button type="button" data-casa="${esc(op)}">${esc(op)}</button>`
    ).join("");
    setPrintFeedback(
      `Esse layout é idêntico entre duas casas — qual é de verdade?<div class="casa-choice-buttons">${botoes}</div>`
    );
    document.querySelectorAll("#new-bet-print-feedback .casa-choice-buttons button").forEach(btn => {
      btn.addEventListener("click", async () => {
        setPrintFeedback("");
        showPrintLoading(true);
        try {
          const res = await fetch("/api/resolve_casa_image", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pendencia_id: result.pendencia_id, casa: btn.dataset.casa }),
          });
          const data = await res.json();
          handlePrintResult(data, mes);
        } catch (err) {
          showPrintLoading(false);
          setPrintFeedback("Não consegui registrar: " + err.message, "error");
        }
      });
    });
  } else {
    sendBtn.disabled = false;
    setPrintFeedback(result.message || "Deu erro ao processar o print.", "error");
  }
}

// Depois de registrar apostas por print, se alguma ficou sem horário (ex:
// BetBra, que nunca recebe automático — ou a IA não conseguiu ler com
// confiança), pede pra preencher aqui antes de fechar a janela, em vez de
// fechar direto e depender de caçar cada linha depois pra editar.
function renderHorarioPendenteForm(mes, pendentes, linhasHtml) {
  const horaAgora = horaAtualHHMM();
  const camposHtml = pendentes.map((p, i) => `
    <div class="horario-pendente-item">
      <span class="horario-pendente-label" title="${esc(p.descricao)}">${esc(p.descricao)}</span>
      <input type="text" class="edit-input small" id="horario-pendente-${i}" value="${horaAgora}" onblur="formatHorarioInput(this)">
    </div>
  `).join("");

  setPrintFeedback(`
    ${linhasHtml}
    <div class="horario-pendente-box">
      <div class="horario-pendente-title">Não veio horário nessas — preenche antes de fechar (ou deixa em branco e edita depois):</div>
      ${camposHtml}
      <div class="horario-pendente-actions">
        <button type="button" class="modal-btn cancel" id="horario-pendente-pular">Fechar sem preencher</button>
        <button type="button" class="modal-btn save" id="horario-pendente-salvar">Salvar horários</button>
      </div>
    </div>
  `);

  document.getElementById("horario-pendente-pular").addEventListener("click", () => {
    refreshMes(mes);
    closeNewBetModal();
  });

  document.getElementById("horario-pendente-salvar").addEventListener("click", async () => {
    const btn = document.getElementById("horario-pendente-salvar");
    btn.disabled = true;
    btn.textContent = "Salvando...";
    try {
      await Promise.all(pendentes.map((p, i) => {
        const valor = document.getElementById(`horario-pendente-${i}`).value.trim();
        if (!valor) return Promise.resolve();
        return fetch("/api/update_bet", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mes, row: p.row, updates: { horario: valor } }),
        });
      }));
    } catch (err) {
      // não trava o fechamento por causa disso — as apostas já foram
      // registradas, só o horário que pode não ter salvo; dá pra editar
      // manualmente depois pelo Histórico
    }
    refreshMes(mes);
    closeNewBetModal();
  });
}

document.getElementById("new-bet-print-send").addEventListener("click", async () => {
  const mes = document.getElementById("new-bet-print-mes").value;
  const dataIsoDigitada = document.getElementById("new-bet-print-data").value.trim();
  // o input type="date" devolve "aaaa-mm-dd" — a planilha espera "dd/mm/aaaa"
  const dataAposta = dataIsoDigitada
    ? dataIsoDigitada.split("-").reverse().join("/")
    : "";
  const fileInput = document.getElementById("new-bet-print-file");
  const caption = document.getElementById("new-bet-print-caption").value;
  const imagemParaEnviar = fileInput.files.length ? fileInput.files[0] : PASTED_IMAGE;

  if (!mes) { alert("Escolha um mês."); return; }
  if (!imagemParaEnviar) { alert("Escolhe o print da aposta (ou cola com Ctrl+V)."); return; }

  const sendBtn = document.getElementById("new-bet-print-send");
  sendBtn.disabled = true;
  setPrintFeedback("");
  showPrintLoading(true);

  const formData = new FormData();
  formData.append("image", imagemParaEnviar, imagemParaEnviar.name || "print.png");
  formData.append("mes", mes);
  formData.append("caption", caption);
  formData.append("data", dataAposta);

  try {
    const res = await fetch("/api/add_bet_from_image", { method: "POST", body: formData });
    const data = await res.json();
    handlePrintResult(data, mes);
  } catch (err) {
    showPrintLoading(false);
    sendBtn.disabled = false;
    setPrintFeedback("Não consegui enviar o print: " + err.message, "error");
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
        <td data-label="Tipster">${l.tipster}</td>
        <td data-label="Apostas" class="col-center">${l.apostas}</td>
        <td data-label="Taxa de acerto" class="col-center">${l.taxa !== null ? l.taxa.toFixed(1).replace(".", ",") + "%" : "—"}</td>
        <td data-label="ROI" class="col-center">${l.roi !== null ? fmtPct(l.roi) : "—"}</td>
        <td data-label="Resultado" class="${cls}"><b>${fmtDual(l.lucro, l.lucroReais, true)}</b></td>
      </tr>
    `;
  }).join("");
}

// ---------- Bancas por casa ----------
// Diferença em R$ abaixo da qual NÃO mostramos alerta (arredondamento de centavos).
const TOLERANCIA_LUCRO = 1.00;

// Lucro por casa vindo do planilhamento (mesma base da Visão geral), só do mês
// ativo e sem aplicar o filtro de tipster.
function lucroPlanilhamentoPorCasa() {
  const porCasa = {};
  ALL_BETS.forEach(b => {
    if (!b.casa) return;
    if (ACTIVE_MES && b.mes !== ACTIVE_MES) return;
    if (!isResolved(b)) return;
    porCasa[b.casa] = (porCasa[b.casa] || 0) + b.lucro_reais;
  });
  return porCasa;
}

let LAST_BANCAS_RESUMO = [];
let LAST_BANCAS_CONTAS = [];
let EXPANDED_CASA = null;

async function loadBancas() {
  const tbody = document.getElementById("bancas-table-body");
  if (!tbody) return;

  if (!ACTIVE_MES) {
    document.getElementById("banca-total").textContent = "—";
    document.getElementById("banca-total-foot").textContent = "Selecione um mês no filtro";
    tbody.innerHTML = `<tr><td colspan="4">Selecione um mês no filtro pra ver as bancas desse mês.</td></tr>`;
    return;
  }

  tbody.innerHTML = `<tr><td colspan="4">Carregando...</td></tr>`;
  try {
    const res = await fetch(`/api/bancas/${encodeURIComponent(ACTIVE_MES)}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Erro ao carregar bancas");
    LAST_BANCAS_RESUMO = data.resumo;
    LAST_BANCAS_CONTAS = data.contas;
    renderBancasTable();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="4">Erro: ${err.message}</td></tr>`;
  }
}

function renderBancasTable() {
  const tbody = document.getElementById("bancas-table-body");
  if (!tbody) return;

  const linhasOrdenadas = SORT_STATE.banca.key
    ? applySort(LAST_BANCAS_RESUMO, SORT_STATE.banca, (l, k) => l[k])
    : LAST_BANCAS_RESUMO.slice().sort((a, b) => a.casa.localeCompare(b.casa, "pt-BR", { sensitivity: "base" }));

  const totalGeral = LAST_BANCAS_RESUMO.reduce((s, r) => s + r.banca, 0);
  const lucroGeral = LAST_BANCAS_RESUMO.reduce((s, r) => s + (r.lucro || 0), 0);
  const lucroPorCasaPlan = lucroPlanilhamentoPorCasa();
  const casasComConta = LAST_BANCAS_RESUMO.filter(r => r.contas > 0).length;
  const casasComLucro = LAST_BANCAS_RESUMO.filter(r => (r.lucro || 0) !== 0).length;

  const lucroEl = document.getElementById("lucro-total");
  lucroEl.textContent = lucroGeral.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  lucroEl.className = "card-value" + (lucroGeral > 0 ? " positive" : lucroGeral < 0 ? " negative" : "");
  document.getElementById("lucro-total-foot").textContent =
    `${casasComLucro} casa${casasComLucro === 1 ? "" : "s"} com movimento`;
  document.getElementById("lucro-total-card").className =
    "card" + (lucroGeral > 0 ? " card-highlight" : lucroGeral < 0 ? " card-highlight-red" : "");

  document.getElementById("banca-total").textContent =
    totalGeral.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  document.getElementById("banca-total-foot").textContent =
    `${casasComConta} casa${casasComConta === 1 ? "" : "s"} ativa${casasComConta === 1 ? "" : "s"}`;

  if (!linhasOrdenadas.length) {
    tbody.innerHTML = `<tr><td colspan="4">Não encontrei a tabela de bancas nessa aba.</td></tr>`;
    return;
  }

  tbody.innerHTML = linhasOrdenadas.map(l => {
    const lucro = l.lucro || 0;
    const lucroClass = lucro > 0 ? "positive" : (lucro < 0 ? "negative" : "");

    const lucroPlan = lucroPorCasaPlan[l.casa] || 0;
    const dif = lucro - lucroPlan;
    const bate = Math.abs(dif) <= TOLERANCIA_LUCRO;
    const fmtR = n => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    const alertaHtml = bate
      ? ""
      : `<span class="banca-alerta" onclick="event.stopPropagation(); abrirAjusteBanca('${escJs(l.casa)}')" title="Planilhamento: ${fmtR(lucroPlan)} — diferença de ${fmtR(Math.abs(dif))}. Clique para ajustar.">${ICON_ALERTA}</span>`;

    const rowHtml = `
      <tr class="banca-casa-row" onclick="toggleBancaCasa('${escJs(l.casa)}')">
        <td data-label="Casa">${l.casa}</td>
        <td data-label="Contas ativas" class="col-center">${l.contas} conta${l.contas === 1 ? "" : "s"} ativa${l.contas === 1 ? "" : "s"}</td>
        <td data-label="Banca somada" class="col-center"><b>${l.banca.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</b></td>
        <td data-label="Lucro" class="banca-lucro-cell">
          <b class="${lucroClass}">${lucro.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</b>${alertaHtml}
        </td>
      </tr>
    `;
    if (EXPANDED_CASA !== l.casa) return rowHtml;

    const contasDaCasa = LAST_BANCAS_CONTAS.filter(c => c.casa === l.casa);
    const detailHtml = `
      <tr class="banca-detail-row">
        <td colspan="4">
          <div class="banca-detail-inner">
            ${contasDaCasa.map(c => `
              <div class="banca-conta-line">
                <span class="banca-conta-nome">${c.nome || "—"}</span>
                <input class="edit-input" id="banca-input-${c.row}" title="Saldo atual (coluna Final)" value="${esc((c.final ?? c.banca).toFixed(2).replace(".", ","))}">
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

// ---------- Ajuste de banca (clique no ⚠) ----------
let AJUSTE_PENDENTE = null;

function fmtBRLSimples(n) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// A "última" aposta é a mais recente por data; empate é desempatado pela
// linha da planilha (linha maior = registrada depois).
function ultimaApostaPorResultado(casa, resultado) {
  const candidatas = ALL_BETS.filter(b =>
    b.casa === casa &&
    b.mes === ACTIVE_MES &&
    (b.resultado || "").toLowerCase() === resultado
  );
  candidatas.sort((a, b) => {
    const da = a.data_iso || "";
    const db = b.data_iso || "";
    if (da !== db) return da < db ? -1 : 1;
    return a.row - b.row;
  });
  return candidatas.length ? candidatas[candidatas.length - 1] : null;
}

function calcularAjusteBanca(casa) {
  const linha = LAST_BANCAS_RESUMO.find(r => r.casa === casa);
  const lucroBancas = linha ? (linha.lucro || 0) : 0;
  const lucroPlan = lucroPlanilhamentoPorCasa()[casa] || 0;
  const dif = lucroBancas - lucroPlan;
  const base = { casa, lucroBancas, lucroPlan, dif };

  if (dif > 0) {
    // falta lucro no planilhamento -> sobe a odd da última green
    const aposta = ultimaApostaPorResultado(casa, "green");
    if (!aposta) return { ...base, erro: "Não achei nenhuma aposta Green dessa casa no mês pra ajustar." };
    if (!aposta.stake_reais) return { ...base, erro: "A última Green dessa casa está com valor apostado zerado — não dá pra ajustar pela odd." };
    const oddExata = aposta.odd + dif / aposta.stake_reais;
    const sobraCom = casas => {
      const v = Number(oddExata.toFixed(casas));
      return dif - (aposta.stake_reais * (v - 1) - aposta.lucro_reais);
    };
    // 2 casas deixa a odd com cara de odd; só usa 4 se 2 não fecharem a conta
    const casas = Math.abs(sobraCom(2)) <= TOLERANCIA_LUCRO ? 2 : 4;
    const novaOdd = Number(oddExata.toFixed(casas));
    const lucroNovo = aposta.stake_reais * (novaOdd - 1);
    return {
      ...base,
      aposta,
      campo: "odd",
      valorAtual: aposta.odd,
      valorNovo: novaOdd,
      sobra: dif - (lucroNovo - aposta.lucro_reais),
      oddInvalida: novaOdd < 1.01,
      updates: { odd: String(novaOdd).replace(".", ",") },
    };
  }

  // sobra lucro no planilhamento -> aumenta a stake da última red
  const falta = Math.abs(dif);
  const aposta = ultimaApostaPorResultado(casa, "red");
  if (!aposta) return { ...base, erro: "Não achei nenhuma aposta Red dessa casa no mês pra ajustar." };
  const novaStake = Number((aposta.stake + falta / window.STAKE_BASE).toFixed(4));
  const novoValor = novaStake * window.STAKE_BASE;
  return {
    ...base,
    aposta,
    campo: "stake",
    valorAtual: aposta.stake,
    valorNovo: novaStake,
    valorAtualReais: aposta.stake_reais,
    valorNovoReais: novoValor,
    sobra: dif + (novoValor - aposta.stake_reais),
    oddInvalida: false,
    updates: { stake: novaStake.toFixed(4).replace(".", ",") },
  };
}

function abrirAjusteBanca(casa) {
  const calc = calcularAjusteBanca(casa);
  const body = document.getElementById("ajuste-body");
  const btn = document.getElementById("ajuste-confirm");

  const resumo = `
    <div class="ajuste-resumo">
      <div><span>Banca</span><b>${fmtBRLSimples(calc.lucroBancas)}</b></div>
      <div><span>Planilhamento</span><b>${fmtBRLSimples(calc.lucroPlan)}</b></div>
      <div><span>Diferença</span><b class="${calc.dif > 0 ? "positive" : "negative"}">${fmtBRLSimples(calc.dif)}</b></div>
    </div>
  `;

  if (calc.erro) {
    AJUSTE_PENDENTE = null;
    body.innerHTML = resumo + `<p class="ajuste-aviso">${calc.erro}</p>`;
    btn.style.display = "none";
    document.getElementById("ajuste-overlay").style.display = "flex";
    return;
  }

  AJUSTE_PENDENTE = calc;
  const a = calc.aposta;
  const linhaValor = calc.campo === "odd"
    ? `<div><span>Odd</span><b>${fmtOdd(calc.valorAtual)} &rarr; ${fmtOdd(calc.valorNovo)}</b></div>`
    : `<div><span>Valor apostado</span><b>${fmtBRLSimples(calc.valorAtualReais)} &rarr; ${fmtBRLSimples(calc.valorNovoReais)}</b></div>`;

  const avisos = [];
  if (calc.oddInvalida) {
    avisos.push("A odd resultante fica abaixo de 1,01, o que não existe na prática. Confirme só se souber o que está fazendo.");
  }
  if (Math.abs(calc.sobra) > TOLERANCIA_LUCRO) {
    avisos.push(`Mesmo com o ajuste vai sobrar ${fmtBRLSimples(Math.abs(calc.sobra))} de diferença — o arredondamento não cobre tudo.`);
  }
  if (Math.abs(calc.dif) > 500) {
    avisos.push("Diferença grande pra jogar numa aposta só. Vale checar antes se não é banca desatualizada ou aposta fora do planilhamento.");
  }

  body.innerHTML = resumo + `
    <p class="ajuste-texto">Vou alterar ${calc.campo === "odd" ? "a odd da última aposta <b>Green</b>" : "o valor da última aposta <b>Red</b>"} da ${esc(casa)}:</p>
    <div class="ajuste-aposta">
      <div class="ajuste-aposta-titulo">${a.aposta || "—"}</div>
      <div class="ajuste-aposta-sub">${a.data || "—"} · ${a.tipster || "sem tipster"}</div>
    </div>
    <div class="ajuste-resumo">${linhaValor}</div>
    ${avisos.map(t => `<p class="ajuste-aviso">${t}</p>`).join("")}
  `;
  btn.style.display = "";
  btn.disabled = false;
  btn.textContent = "Confirmar ajuste";
  document.getElementById("ajuste-overlay").style.display = "flex";
}

function fecharAjusteBanca() {
  document.getElementById("ajuste-overlay").style.display = "none";
  AJUSTE_PENDENTE = null;
}

async function confirmarAjusteBanca() {
  if (!AJUSTE_PENDENTE) return;
  const calc = AJUSTE_PENDENTE;
  const btn = document.getElementById("ajuste-confirm");
  btn.disabled = true;
  btn.textContent = "Salvando...";
  try {
    const res = await fetch("/api/update_bet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mes: calc.aposta.mes, row: calc.aposta.row, updates: calc.updates }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Erro ao salvar");
    fecharAjusteBanca();
    setTimeout(async () => {
      await refreshMes(calc.aposta.mes);
      await loadBancas();
    }, 900);
  } catch (err) {
    btn.disabled = false;
    btn.textContent = "Confirmar ajuste";
    document.getElementById("ajuste-body").insertAdjacentHTML(
      "beforeend", `<p class="ajuste-aviso">Não consegui salvar: ${err.message}</p>`
    );
  }
}

document.getElementById("ajuste-cancel").addEventListener("click", fecharAjusteBanca);
document.getElementById("ajuste-confirm").addEventListener("click", confirmarAjusteBanca);
document.getElementById("ajuste-overlay").addEventListener("click", (e) => {
  if (e.target.id === "ajuste-overlay") fecharAjusteBanca();
});

function toggleBancaCasa(casa) {  EXPANDED_CASA = (EXPANDED_CASA === casa) ? null : casa;
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

  // O ROI do bloco de resumo da planilha é sempre do mês inteiro. Só dá pra
  // usar ele quando não há filtro de tipster nem de casa — senão o número
  // fica congelado no geral do mês em vez de refletir o que está filtrado.
  const semFiltroExtra = !ACTIVE_TIPSTER && !ACTIVE_CASA;
  const roiDaPlanilha = ACTIVE_MES && semFiltroExtra ? getRoiPctFromSheet(ACTIVE_MES) : null;
  document.getElementById("metric-liquido-foot").textContent = roiDaPlanilha
    ? `${roiDaPlanilha} de ROI`
    : (volumeApostadoResolved > 0
        ? `${fmtPct(roi)} de ROI`
        : `ROI sobre ${fmtDual(volumeApostadoResolved, volumeApostadoResolvedReais, false)} resolvido`);

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
  document.getElementById("metric-odd").textContent = comOdd.length > 0 ? oddMedia.toFixed(3) : "—";

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
  document.getElementById("ultimas-tips-block").style.display = ACTIVE_TIPSTER ? "" : "none";
  if (ACTIVE_TIPSTER) {
    const ultimas = bets.slice()
      .sort(compareRecentFirst)
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
      .sort(compareRecentFirst)
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
    [ACTIVE_TIPSTER, ACTIVE_CASA, ACTIVE_MES ? formatMesLabel(ACTIVE_MES) : null].filter(Boolean).length
      ? `Filtrado: ${[ACTIVE_TIPSTER, ACTIVE_CASA, ACTIVE_MES ? formatMesLabel(ACTIVE_MES) : null].filter(Boolean).join(" · ")}`
      : "Todas as apostas";
  document.getElementById("chart-title").textContent =
    ACTIVE_TIPSTER ? `Resultado acumulado (${ACTIVE_TIPSTER})` : "Resultado acumulado";

  renderChart(resolved);
  renderCasaSummary(bets);
  renderTipsterSummary(bets);
  renderTipoSummary(bets);
  renderHistorico();
  if (CURRENT_VIEW === "ranking") renderRanking();
  if (CURRENT_VIEW === "bancas") loadBancas();
}

// ---------- Lucro por casa (Visão geral) ----------
function renderCasaSummary(bets) {
  const tbody = document.getElementById("casa-summary-body");
  if (!tbody) return;

  const porCasa = {};
  bets.forEach(b => {
    if (!b.casa) return;
    if (!porCasa[b.casa]) porCasa[b.casa] = { apostas: 0, stake: 0, lucro: 0, lucroReais: 0 };
    const c = porCasa[b.casa];
    c.apostas += 1;
    if (isResolved(b)) {
      c.stake += b.stake;
      c.lucro += b.lucro_uni;
      c.lucroReais += b.lucro_reais;
    }
  });

  const linhas = applySort(
    Object.entries(porCasa).map(([casa, c]) => ({
      casa, ...c, roi: c.stake > 0 ? (c.lucro / c.stake) * 100 : null,
    })),
    SORT_STATE.casa,
    (l, k) => l[k]
  );
  if (!SORT_STATE.casa.key) linhas.sort((a, b) => a.casa.localeCompare(b.casa, "pt-BR", { sensitivity: "base" }));

  if (!linhas.length) {
    tbody.innerHTML = `<tr><td colspan="3">Sem apostas nesse filtro ainda.</td></tr>`;
    return;
  }

  tbody.innerHTML = linhas.map(l => {
    const cls = l.lucro > 0 ? "positive" : l.lucro < 0 ? "negative" : "";
    return `
      <tr>
        <td>${l.casa}</td>
        <td class="col-center">${l.apostas}</td>
        <td class="col-center ${l.roi == null ? "" : l.roi > 0 ? "positive" : l.roi < 0 ? "negative" : ""}">${l.roi == null ? "—" : fmtPct(l.roi)}</td>
        <td class="${cls}"><b>${fmtDual(l.lucro, l.lucroReais, true)}</b></td>
      </tr>
    `;
  }).join("");
}

// ---------- Tipsters do mês (Visão geral) ----------
function renderTipsterSummary(bets) {
  const tbody = document.getElementById("tipster-summary-body");
  if (!tbody) return;

  const porTipster = {};
  bets.forEach(b => {
    const nome = (b.tipster || "").trim();
    if (!nome) return;
    if (!porTipster[nome]) porTipster[nome] = { apostas: 0, stake: 0, lucro: 0, lucroReais: 0 };
    const t = porTipster[nome];
    t.apostas += 1;
    if (isResolved(b)) {
      t.stake += b.stake;
      t.lucro += b.lucro_uni;
      t.lucroReais += b.lucro_reais;
    }
  });

  const linhas = Object.entries(porTipster)
    .map(([tipster, t]) => ({ tipster, ...t, roi: t.stake > 0 ? (t.lucro / t.stake) * 100 : null }))
    .sort((a, b) => a.tipster.localeCompare(b.tipster, "pt-BR", { sensitivity: "base" }));

  if (!linhas.length) {
    tbody.innerHTML = `<tr><td colspan="3">Sem apostas nesse filtro ainda.</td></tr>`;
    return;
  }

  tbody.innerHTML = linhas.map(l => {
    const cls = l.lucro > 0 ? "positive" : l.lucro < 0 ? "negative" : "";
    return `
      <tr>
        <td>${l.tipster}</td>
        <td class="col-center">${l.apostas}</td>
        <td class="col-center ${l.roi == null ? "" : l.roi > 0 ? "positive" : l.roi < 0 ? "negative" : ""}">${l.roi == null ? "—" : fmtPct(l.roi)}</td>
        <td class="${cls}"><b>${fmtDual(l.lucro, l.lucroReais, true)}</b></td>
      </tr>
    `;
  }).join("");
}

// ---------- Pré / Live (painel lateral da Visão geral) ----------
// A coluna Tipo da planilha fica em branco pros tipsters que mandam os dois.
function renderTipoSummary(bets) {
  const lista = document.getElementById("tipo-summary-list");
  if (!lista) return;

  const buckets = {
    "Pré": { apostas: 0, lucro: 0, lucroReais: 0 },
    "Live": { apostas: 0, lucro: 0, lucroReais: 0 },
    "Sem tipo": { apostas: 0, lucro: 0, lucroReais: 0 },
  };

  bets.forEach(b => {
    const bruto = stripAcentos((b.tipo || "").trim()).toLowerCase();
    const chave = bruto.startsWith("pre") ? "Pré" : (bruto === "live" ? "Live" : "Sem tipo");
    const t = buckets[chave];
    t.apostas += 1;
    if (isResolved(b)) {
      t.lucro += b.lucro_uni;
      t.lucroReais += b.lucro_reais;
    }
  });

  // "Sem tipo" só aparece se existir de fato
  const linhas = Object.entries(buckets)
    .filter(([nome, t]) => nome !== "Sem tipo" || t.apostas > 0)
    .map(([nome, t]) => ({ nome, ...t }));

  if (!linhas.some(l => l.apostas > 0)) {
    lista.innerHTML = `<span class="side-note">Sem apostas nesse filtro ainda.</span>`;
    return;
  }

  lista.innerHTML = linhas.map(l => {
    const cls = l.lucro > 0 ? "positive" : l.lucro < 0 ? "negative" : "";
    return `
      <div class="tipo-line">
        <span class="tipo-nome">${l.nome}</span>
        <span class="tipo-qtd">${l.apostas} aposta${l.apostas === 1 ? "" : "s"}</span>
        <span class="tipo-lucro ${cls}">${fmtDual(l.lucro, l.lucroReais, true)}</span>
      </div>
    `;
  }).join("");
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
      const fonteAtual = getComputedStyle(document.body).getPropertyValue("--font-family") || "Montserrat, sans-serif";
      c.font = `bold 11px ${fonteAtual}`;
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

  const temaAtual = THEMES.find(t => t.id === CURRENT_THEME) || THEMES[0];
  const gridColor = temaAtual.group !== "light" ? "rgba(255,255,255,0.08)" : "#eef1f6";
  const tickColor = getComputedStyle(document.body).getPropertyValue("--muted").trim() || "#7a8494";

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
      ...(window.innerWidth <= 900 ? { aspectRatio: 1.3 } : {}),
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

document.getElementById("refresh-btn").addEventListener("click", async () => {
  const btn = document.getElementById("refresh-btn");
  btn.classList.add("spinning");
  btn.disabled = true;
  try {
    await loadData(true);
  } finally {
    btn.classList.remove("spinning");
    btn.disabled = false;
  }
});

setupSortableHeaders(HIST_HEADERS, "hist", renderHistorico);

// Botão "Por horário": aciona o mesmo clique do cabeçalho "Data" da Tabela
// (que já ordena por data+hora combinados) — assim os dois controles ficam
// sempre sincronizados, funcionando tanto no modo Cards quanto na Tabela.
function syncSortByHorarioBtn() {
  const btn = document.getElementById("sort-by-horario-btn");
  if (!btn) return;
  const disponivel = ONLY_TODAY || ONLY_YESTERDAY || ONLY_PENDING_TODAY || ONLY_PENDING_FUTURE;
  btn.disabled = !disponivel;
  btn.title = disponivel ? "" : "Só funciona com Hoje, Ontem, Pend. hoje ou Pend. futuro ativado";
  const ativo = disponivel && SORT_STATE.hist.key === "data_hora_sort";
  btn.classList.toggle("active", ativo);
  const arrow = btn.querySelector(".sort-arrow");
  if (arrow) arrow.textContent = ativo ? (SORT_STATE.hist.dir === 1 ? "▲" : "▼") : "";
}
document.getElementById("sort-by-horario-btn").addEventListener("click", () => {
  if (!(ONLY_TODAY || ONLY_YESTERDAY || ONLY_PENDING_TODAY || ONLY_PENDING_FUTURE)) return;
  document.getElementById("th-hist-data").click();
});

// Enter no modal "Nova aposta" aciona o botão certo (Salvar aposta no modo
// Manual, Enviar print no modo Por print) — funciona em qualquer campo de
// texto do formulário, não só num específico.
document.getElementById("new-bet-overlay").addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  if (e.target.tagName === "TEXTAREA") return; // não se aplica aqui, mas por segurança
  e.preventDefault();
  const modoPrint = document.getElementById("new-bet-print-form").style.display !== "none";
  const btn = document.getElementById(modoPrint ? "new-bet-print-send" : "new-bet-save");
  if (btn && !btn.disabled) btn.click();
});
setupSortableHeaders(RANK_HEADERS, "rank", renderRanking);
setupSortableHeaders(BANCA_HEADERS, "banca", renderBancasTable);
setupSortableHeaders(CASA_HEADERS, "casa", () => renderCasaSummary(currentBets()));

// aplica o tema salvo antes de tudo — migra do sistema antigo (só claro/escuro)
// se a pessoa nunca escolheu um tema novo ainda. Sem nada salvo, o padrão
// agora é o Nebulosa (em vez do claro de antes).
try {
  const salvo = localStorage.getItem("painel_theme");
  if (salvo) {
    applyTheme(salvo);
  } else if (localStorage.getItem("painel_dark_mode") === "1") {
    applyTheme("dark-default");
  } else {
    applyTheme("dark-nebulosa");
  }
} catch (e) {
  applyTheme("dark-nebulosa");
}

// aplica a fonte salva
try {
  const fonteSalva = localStorage.getItem("painel_font");
  if (fonteSalva) applyFont(fonteSalva);
} catch (e) {}

setToday();
loadData();

// ---------- Cadastro de Tipsters e Casas (Configurações) ----------
async function carregarRegistros() {
  try {
    const [resT, resC] = await Promise.all([fetch("/api/tipsters"), fetch("/api/casas")]);
    const dataT = await resT.json();
    const dataC = await resC.json();
    if (dataT.ok) TIPSTERS_REGISTRY = dataT.tipsters;
    if (dataC.ok) CASAS_REGISTRY = dataC.casas;
    atualizarTelasDeCadastro();
  } catch (e) {
    // se falhar, os atalhos de tipster continuam funcionando só com o que
    // já existe nas apostas (comportamento de antes desse cadastro existir)
  }
}
carregarRegistros();

function renderTipstersList() {
  const container = document.getElementById("tipsters-list");
  if (!container) return;
  const ordenados = [...TIPSTERS_REGISTRY].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" }));
  if (!ordenados.length) {
    container.innerHTML = `<p class="cadastro-vazio">Nenhum tipster cadastrado ainda.</p>`;
    return;
  }
  container.innerHTML = ordenados.map(t => `
    <div class="cadastro-item">
      <span class="cadastro-item-nome">${esc(t.nome)}${t.tipo ? `<span class="cadastro-item-tipo">${esc(t.tipo)}</span>` : ""}</span>
      <button type="button" class="cadastro-status-toggle ${t.status === "Ativo" ? "ativo" : "inativo"}" data-nome="${escJs(t.nome)}" data-status="${t.status}">${t.status}</button>
      <button type="button" class="cadastro-remove-btn" data-nome="${escJs(t.nome)}" title="Remover">✕</button>
    </div>
  `).join("");

  container.querySelectorAll(".cadastro-status-toggle").forEach(btn => {
    btn.addEventListener("click", () => alternarStatusTipster(btn.dataset.nome, btn.dataset.status));
  });
  container.querySelectorAll(".cadastro-remove-btn").forEach(btn => {
    btn.addEventListener("click", () => removerTipster(btn.dataset.nome));
  });
}

function renderCasasList() {
  const container = document.getElementById("casas-list");
  if (!container) return;
  const ordenadas = [...CASAS_REGISTRY].sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" }));
  if (!ordenadas.length) {
    container.innerHTML = `<p class="cadastro-vazio">Nenhuma casa cadastrada ainda.</p>`;
    return;
  }
  container.innerHTML = ordenadas.map(nome => `
    <div class="cadastro-item">
      <span class="cadastro-item-nome">${esc(nome)}</span>
      <button type="button" class="cadastro-remove-btn" data-nome="${escJs(nome)}" title="Remover">✕</button>
    </div>
  `).join("");

  container.querySelectorAll(".cadastro-remove-btn").forEach(btn => {
    btn.addEventListener("click", () => removerCasa(btn.dataset.nome));
  });
}

function setCadastroFeedback(id, texto, ehErro) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = texto;
  el.className = "cadastro-feedback" + (ehErro ? " erro" : "");
}

let NOVO_TIPSTER_TIPO = "";
document.querySelectorAll("#novo-tipster-tipo-pre, #novo-tipster-tipo-live, #novo-tipster-tipo-ambos").forEach(btn => {
  btn.addEventListener("click", () => {
    NOVO_TIPSTER_TIPO = btn.dataset.tipo;
    document.querySelectorAll("#novo-tipster-tipo-pre, #novo-tipster-tipo-live, #novo-tipster-tipo-ambos").forEach(b => {
      b.classList.toggle("active", b === btn);
    });
  });
});

// Depois de qualquer mudança local (otimista) no cadastro, esses 4 lugares
// da tela precisam refletir isso — centralizado aqui pra não repetir em
// cada uma das 6 funções de adicionar/trocar/remover.
function atualizarTelasDeCadastro() {
  renderTipstersList();
  renderCasasList();
  renderPrintTipsterChips();
  populateNewBetTipsterOptions();
}

async function adicionarTipsterUI() {
  const input = document.getElementById("novo-tipster-input");
  const nome = input.value.trim();
  if (!nome) return;
  if (!NOVO_TIPSTER_TIPO) {
    setCadastroFeedback("tipsters-cadastro-feedback", "Escolhe se ele é Pré, Live ou Pré + Live antes de adicionar.", true);
    return;
  }
  setCadastroFeedback("tipsters-cadastro-feedback", "");

  // atualiza a tela na hora (otimista) — não espera o servidor confirmar
  // pra já mostrar o tipster novo na lista
  const tipo = NOVO_TIPSTER_TIPO;
  const novoItem = { nome, status: "Ativo", tipo };
  TIPSTERS_REGISTRY.push(novoItem);
  atualizarTelasDeCadastro();
  input.value = "";
  NOVO_TIPSTER_TIPO = "";
  document.querySelectorAll("#novo-tipster-tipo-pre, #novo-tipster-tipo-live, #novo-tipster-tipo-ambos").forEach(b => b.classList.remove("active"));

  try {
    const res = await fetch("/api/tipsters", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nome, tipo }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Não consegui adicionar.");
  } catch (e) {
    // deu errado no servidor — desfaz a mudança otimista
    TIPSTERS_REGISTRY = TIPSTERS_REGISTRY.filter(t => t !== novoItem);
    atualizarTelasDeCadastro();
    setCadastroFeedback("tipsters-cadastro-feedback", e.message, true);
  }
}
document.getElementById("novo-tipster-btn").addEventListener("click", adicionarTipsterUI);
document.getElementById("novo-tipster-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); adicionarTipsterUI(); }
});

async function alternarStatusTipster(nome, statusAtual) {
  const novoStatus = statusAtual === "Ativo" ? "Inativo" : "Ativo";
  const item = TIPSTERS_REGISTRY.find(t => t.nome === nome);
  if (!item) return;
  const statusAnterior = item.status;
  item.status = novoStatus; // otimista
  atualizarTelasDeCadastro();

  try {
    const res = await fetch("/api/tipsters/status", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nome, status: novoStatus }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Não consegui atualizar.");
  } catch (e) {
    item.status = statusAnterior; // desfaz
    atualizarTelasDeCadastro();
    setCadastroFeedback("tipsters-cadastro-feedback", e.message, true);
  }
}

async function removerTipster(nome) {
  if (!confirm(`Remover "${nome}" do cadastro? As apostas antigas dele continuam intactas no histórico.`)) return;
  const idx = TIPSTERS_REGISTRY.findIndex(t => t.nome === nome);
  if (idx === -1) return;
  const [removido] = TIPSTERS_REGISTRY.splice(idx, 1); // otimista
  atualizarTelasDeCadastro();

  try {
    const res = await fetch("/api/tipsters/remover", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nome }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Não consegui remover.");
  } catch (e) {
    TIPSTERS_REGISTRY.splice(idx, 0, removido); // devolve no mesmo lugar
    atualizarTelasDeCadastro();
    setCadastroFeedback("tipsters-cadastro-feedback", e.message, true);
  }
}

async function adicionarCasaUI() {
  const input = document.getElementById("nova-casa-input");
  const nome = input.value.trim();
  if (!nome) return;
  setCadastroFeedback("casas-cadastro-feedback", "");

  CASAS_REGISTRY.push(nome); // otimista
  atualizarTelasDeCadastro();
  input.value = "";

  try {
    const res = await fetch("/api/casas", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nome }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Não consegui adicionar.");
  } catch (e) {
    CASAS_REGISTRY = CASAS_REGISTRY.filter(c => c !== nome);
    atualizarTelasDeCadastro();
    setCadastroFeedback("casas-cadastro-feedback", e.message, true);
  }
}
document.getElementById("nova-casa-btn").addEventListener("click", adicionarCasaUI);
document.getElementById("nova-casa-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); adicionarCasaUI(); }
});

async function removerCasa(nome) {
  if (!confirm(`Remover "${nome}" do cadastro? As apostas antigas continuam intactas no histórico.`)) return;
  const idx = CASAS_REGISTRY.indexOf(nome);
  if (idx === -1) return;
  CASAS_REGISTRY.splice(idx, 1); // otimista
  atualizarTelasDeCadastro();

  try {
    const res = await fetch("/api/casas/remover", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nome }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Não consegui remover.");
  } catch (e) {
    CASAS_REGISTRY.splice(idx, 0, nome); // devolve no mesmo lugar
    atualizarTelasDeCadastro();
    setCadastroFeedback("casas-cadastro-feedback", e.message, true);
  }
}
