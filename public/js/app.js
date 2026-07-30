const state = {
  data: null,
  loads: [],
  compareIds: new Set(),
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function formatWh(wh) {
  if (wh >= 1000) return `${(wh / 1000).toFixed(2)} kWh`;
  return `${Math.round(wh)} Wh`;
}

function formatW(w) {
  if (w >= 1000) return `${(w / 1000).toFixed(2)} kW`;
  return `${Math.round(w)} W`;
}

function formatBrl(n) {
  if (n == null) return "—";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

async function loadData() {
  const res = await fetch("/api/estacoes");
  if (!res.ok) throw new Error("Falha ao carregar catálogo");
  state.data = await res.json();
}

function getParams() {
  return {
    days: Number($("#param-days").value) || 1,
    dod: (Number($("#param-dod").value) || 90) / 100,
    eff: (Number($("#param-eff").value) || 90) / 100,
    margin: (Number($("#param-margin").value) || 0) / 100,
    simult: Number($("#param-simult").value) || null,
  };
}

function computeSizing() {
  const params = getParams();
  const dailyWh = state.loads.reduce((sum, l) => sum + l.watts * l.hoursPerDay, 0);
  const continuousW = params.simult ?? state.loads.reduce((sum, l) => sum + l.watts, 0);
  const surgeW = state.loads.reduce((max, l) => Math.max(max, l.surgeW || l.watts), 0);
  const neededRaw = dailyWh * params.days;
  const withEff = neededRaw / Math.max(params.eff, 0.01);
  const withDod = withEff / Math.max(params.dod, 0.01);
  const neededWh = withDod * (1 + params.margin);

  return { dailyWh, continuousW, surgeW, neededWh, params };
}

function scoreStation(station, sizing) {
  const capacity = station.usableWh || station.capacityWh;
  const maxCap = station.expandable && station.maxExpandedWh
    ? station.maxExpandedWh * (station.usableWh / station.capacityWh)
    : capacity;

  const energyOk = capacity >= sizing.neededWh;
  const energyExpandOk = maxCap >= sizing.neededWh;
  const powerOk = station.acOutputW >= sizing.continuousW;
  const surgeOk = station.acSurgeW >= sizing.surgeW;

  let fit = "no";
  let label = "Insuficiente";

  if (energyOk && powerOk && surgeOk) {
    fit = "ok";
    label = "Atende";
  } else if ((energyOk || energyExpandOk) && powerOk) {
    fit = "partial";
    label = energyOk ? "Pico apertado" : "Com expansão";
  } else if (energyExpandOk && powerOk) {
    fit = "partial";
    label = "Com expansão";
  }

  const oversize = capacity / Math.max(sizing.neededWh, 1);
  const score =
    (energyOk ? 100 : energyExpandOk ? 70 : Math.min(60, oversize * 60)) +
    (powerOk ? 25 : Math.min(20, (station.acOutputW / Math.max(sizing.continuousW, 1)) * 20)) +
    (surgeOk ? 10 : 0) -
    Math.max(0, oversize - 2) * 5;

  return { fit, label, score, capacity, maxCap };
}

function renderPresets() {
  const row = $("#preset-row");
  row.innerHTML = "";
  for (const p of state.data.defaultLoads.slice(0, 8)) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip";
    btn.textContent = p.name;
    btn.addEventListener("click", () => {
      addLoad({ ...p });
    });
    row.appendChild(btn);
  }
}

function addLoad(load) {
  state.loads.push({
    id: crypto.randomUUID(),
    name: load.name,
    watts: Number(load.watts),
    hoursPerDay: Number(load.hoursPerDay),
    surgeW: Number(load.surgeW || load.watts),
  });
  renderLoads();
  renderResults();
}

function removeLoad(id) {
  state.loads = state.loads.filter((l) => l.id !== id);
  renderLoads();
  renderResults();
}

function renderLoads() {
  const list = $("#load-list");
  list.innerHTML = "";
  if (!state.loads.length) {
    list.innerHTML = `<li class="empty" style="padding:0.5rem 0">Nenhuma carga adicionada.</li>`;
    return;
  }
  for (const l of state.loads) {
    const li = document.createElement("li");
    li.className = "load-item";
    li.innerHTML = `
      <div>
        <strong>${escapeHtml(l.name)}</strong>
      </div>
      <span>${l.watts}W · ${l.hoursPerDay}h · pico ${l.surgeW}W</span>
      <button type="button" aria-label="Remover">✕</button>
    `;
    li.querySelector("button").addEventListener("click", () => removeLoad(l.id));
    list.appendChild(li);
  }
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderResults() {
  const empty = $("#rec-empty");
  const grid = $("#recommendations");

  if (!state.loads.length) {
    $("#m-daily").textContent = "—";
    $("#m-needed").textContent = "—";
    $("#m-power").textContent = "—";
    $("#m-surge").textContent = "—";
    grid.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }

  empty.classList.add("hidden");
  const sizing = computeSizing();
  $("#m-daily").textContent = formatWh(sizing.dailyWh);
  $("#m-needed").textContent = formatWh(sizing.neededWh);
  $("#m-power").textContent = formatW(sizing.continuousW);
  $("#m-surge").textContent = formatW(sizing.surgeW);

  const brand = $("#filter-brand").value;
  const ranked = state.data.stations
    .filter((s) => !brand || s.brand === brand)
    .map((s) => ({ station: s, meta: scoreStation(s, sizing) }))
    .sort((a, b) => b.meta.score - a.meta.score);

  grid.innerHTML = "";
  for (const item of ranked.slice(0, 12)) {
    grid.appendChild(createStationCard(item.station, item.meta));
  }
}

function createStationCard(station, meta = null) {
  const card = document.createElement("article");
  card.className = "station-card";
  if (meta) card.classList.add(`fit-${meta.fit}`);

  const badge = meta
    ? `<span class="badge ${meta.fit}">${meta.label}</span>`
    : `<span class="badge ok">${station.batteryChemistry}</span>`;

  card.innerHTML = `
    <header>
      <div>
        <h3>${escapeHtml(station.model)}</h3>
        <p class="brand-label">${escapeHtml(station.brand)}</p>
      </div>
      ${badge}
    </header>
    <dl class="specs">
      <dt>Capacidade</dt><dd>${formatWh(station.capacityWh)}</dd>
      <dt>Útil</dt><dd>${formatWh(station.usableWh)}</dd>
      <dt>Saída AC</dt><dd>${formatW(station.acOutputW)}</dd>
      <dt>Pico AC</dt><dd>${formatW(station.acSurgeW)}</dd>
      <dt>Solar</dt><dd>${formatW(station.solarInputW)}</dd>
      <dt>Peso</dt><dd>${station.weightKg} kg</dd>
      <dt>Ciclos</dt><dd>${station.cycleLife.toLocaleString("pt-BR")}</dd>
      <dt>Preço ~</dt><dd>${formatBrl(station.priceBrlApprox)}</dd>
    </dl>
    <div class="card-actions">
      <button type="button" class="btn ghost small" data-compare>${state.compareIds.has(station.id) ? "Na comparação" : "Comparar"}</button>
    </div>
  `;

  card.querySelector("[data-compare]").addEventListener("click", () => toggleCompare(station.id));
  return card;
}

function fillBrandSelects() {
  const brands = [...new Set(state.data.stations.map((s) => s.brand))].sort();
  for (const id of ["filter-brand", "catalog-brand"]) {
    const sel = $(`#${id}`);
    const current = sel.value;
    const first = sel.options[0].outerHTML;
    sel.innerHTML = first;
    for (const b of brands) {
      const opt = document.createElement("option");
      opt.value = b;
      opt.textContent = b;
      sel.appendChild(opt);
    }
    sel.value = current;
  }
}

function renderCatalog() {
  const q = ($("#catalog-search").value || "").trim().toLowerCase();
  const brand = $("#catalog-brand").value;
  const chem = $("#catalog-chem").value;
  const grid = $("#catalog-grid");
  grid.innerHTML = "";

  const list = state.data.stations.filter((s) => {
    if (brand && s.brand !== brand) return false;
    if (chem && s.batteryChemistry !== chem) return false;
    if (!q) return true;
    const hay = `${s.brand} ${s.model} ${s.series}`.toLowerCase();
    return hay.includes(q);
  });

  for (const s of list) {
    grid.appendChild(createStationCard(s));
  }
}

function toggleCompare(id) {
  if (state.compareIds.has(id)) {
    state.compareIds.delete(id);
  } else {
    if (state.compareIds.size >= 3) {
      alert("Compare no máximo 3 modelos.");
      return;
    }
    state.compareIds.add(id);
  }
  renderCompare();
  renderCatalog();
  if (state.loads.length) renderResults();
}

function renderCompare() {
  const picks = $("#compare-picks");
  const wrap = $("#compare-table-wrap");
  picks.innerHTML = "";

  const stations = [...state.compareIds]
    .map((id) => state.data.stations.find((s) => s.id === id))
    .filter(Boolean);

  if (!stations.length) {
    wrap.innerHTML = `<p class="empty">Nenhum modelo selecionado para comparação.</p>`;
    return;
  }

  for (const s of stations) {
    const chip = document.createElement("span");
    chip.className = "compare-chip";
    chip.innerHTML = `${escapeHtml(s.brand)} ${escapeHtml(s.model)} <button type="button" aria-label="Remover">×</button>`;
    chip.querySelector("button").addEventListener("click", () => toggleCompare(s.id));
    picks.appendChild(chip);
  }

  const rows = [
    ["Marca", (s) => s.brand],
    ["Modelo", (s) => s.model],
    ["Química", (s) => s.batteryChemistry],
    ["Capacidade", (s) => formatWh(s.capacityWh)],
    ["Útil", (s) => formatWh(s.usableWh)],
    ["Saída AC", (s) => formatW(s.acOutputW)],
    ["Pico AC", (s) => formatW(s.acSurgeW)],
    ["Entrada solar", (s) => formatW(s.solarInputW)],
    ["Carga AC", (s) => formatW(s.acChargeW)],
    ["Peso", (s) => `${s.weightKg} kg`],
    ["Ciclos", (s) => s.cycleLife.toLocaleString("pt-BR")],
    ["Expansível", (s) => (s.expandable ? `Sim (até ${formatWh(s.maxExpandedWh || s.capacityWh)})` : "Não")],
    ["UPS", (s) => (s.ups ? "Sim" : "Não")],
    ["Preço ~", (s) => formatBrl(s.priceBrlApprox)],
    ["Notas", (s) => s.notes || "—"],
  ];

  wrap.innerHTML = `
    <table class="compare">
      <tbody>
        ${rows
          .map(
            ([label, fn]) => `
          <tr>
            <th>${label}</th>
            ${stations.map((s) => `<td>${escapeHtml(String(fn(s)))}</td>`).join("")}
          </tr>`
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function setupTabs() {
  $$(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      const panel = tab.dataset.panel;
      $$(".tab").forEach((t) => {
        t.classList.toggle("active", t === tab);
        t.setAttribute("aria-selected", t === tab ? "true" : "false");
      });
      $$(".panel").forEach((p) => {
        const active = p.id === `panel-${panel}`;
        p.classList.toggle("active", active);
        p.hidden = !active;
      });
    });
  });
}

function setupForms() {
  $("#load-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("#load-name").value.trim();
    const watts = Number($("#load-watts").value);
    const hours = Number($("#load-hours").value);
    const surge = Number($("#load-surge").value) || watts;
    if (!name || !watts || !hours) return;
    addLoad({ name, watts, hoursPerDay: hours, surgeW: surge });
    e.target.reset();
    $("#load-name").focus();
  });

  ["param-days", "param-dod", "param-eff", "param-margin", "param-simult", "filter-brand"].forEach((id) => {
    $(`#${id}`).addEventListener("input", renderResults);
    $(`#${id}`).addEventListener("change", renderResults);
  });

  ["catalog-search", "catalog-brand", "catalog-chem"].forEach((id) => {
    $(`#${id}`).addEventListener("input", renderCatalog);
    $(`#${id}`).addEventListener("change", renderCatalog);
  });
}

async function init() {
  setupTabs();
  setupForms();
  await loadData();
  fillBrandSelects();
  renderPresets();
  renderLoads();
  renderResults();
  renderCatalog();
  renderCompare();
}

init().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML(
    "afterbegin",
    `<p style="background:#400;color:#fff;padding:1rem;margin:0">Erro ao iniciar: ${escapeHtml(err.message)}</p>`
  );
});
