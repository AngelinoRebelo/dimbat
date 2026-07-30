const state = {
  data: null,
  solar: null,
  loads: [],
  compareIds: new Set(),
  solarCat: "panels",
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

function hostnameOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function externalLink(url, label = "Site oficial") {
  if (!url) return "";
  const host = hostnameOf(url);
  return `<a class="btn ghost small" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(url)}">${escapeHtml(label)} ↗<span class="site-origin">${escapeHtml(host)}</span></a>`;
}

async function loadData() {
  const [stationsRes, solarRes] = await Promise.all([fetch("/api/estacoes"), fetch("/api/solar")]);
  if (!stationsRes.ok) throw new Error("Falha ao carregar estações");
  if (!solarRes.ok) throw new Error("Falha ao carregar catálogo solar");
  state.data = await stationsRes.json();
  state.solar = await solarRes.json();
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
  const maxCap =
    station.expandable && station.maxExpandedWh
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
    btn.addEventListener("click", () => addLoad({ ...p }));
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
      <div><strong>${escapeHtml(l.name)}</strong></div>
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
      ${externalLink(station.productUrl || station.brandUrl, "Ver no site")}
      <button type="button" class="btn ghost small" data-compare>${state.compareIds.has(station.id) ? "Na comparação" : "Comparar"}</button>
    </div>
  `;

  card.querySelector("[data-compare]").addEventListener("click", () => toggleCompare(station.id));
  return card;
}

function createPanelCard(panel, qty = null) {
  const card = document.createElement("article");
  card.className = "station-card";
  const badge = qty
    ? `<span class="badge ok">${qty} un.</span>`
    : `<span class="badge ok">${escapeHtml(panel.type)}</span>`;

  card.innerHTML = `
    <header>
      <div>
        <h3>${escapeHtml(panel.model)}</h3>
        <p class="brand-label">${escapeHtml(panel.brand)}</p>
      </div>
      ${badge}
    </header>
    <dl class="specs">
      <dt>Potência</dt><dd>${formatW(panel.powerW)}</dd>
      <dt>Eficiência</dt><dd>${panel.efficiencyPct}%</dd>
      <dt>Vmp / Imp</dt><dd>${panel.vmpV}V / ${panel.impA}A</dd>
      <dt>Voc / Isc</dt><dd>${panel.vocV}V / ${panel.iscA}A</dd>
      <dt>Células</dt><dd>${panel.cells}</dd>
      <dt>Peso</dt><dd>${panel.weightKg} kg</dd>
      <dt>Garantia</dt><dd>${panel.warrantyYears} anos</dd>
      <dt>Preço ~</dt><dd>${formatBrl(panel.priceBrlApprox)}</dd>
    </dl>
    <div class="card-actions">
      ${externalLink(panel.productUrl || panel.brandUrl, "Ver no site")}
    </div>
  `;
  return card;
}

function createInverterCard(inv, meta = null) {
  const card = document.createElement("article");
  card.className = "station-card";
  if (meta) card.classList.add(`fit-${meta.fit}`);

  const badge = meta
    ? `<span class="badge ${meta.fit}">${meta.label}</span>`
    : `<span class="badge ok">${escapeHtml(inv.type)}</span>`;

  card.innerHTML = `
    <header>
      <div>
        <h3>${escapeHtml(inv.model)}</h3>
        <p class="brand-label">${escapeHtml(inv.brand)}</p>
      </div>
      ${badge}
    </header>
    <dl class="specs">
      <dt>Potência AC</dt><dd>${formatW(inv.acPowerW)}</dd>
      <dt>DC máx.</dt><dd>${inv.maxDcW ? formatW(inv.maxDcW) : "—"}</dd>
      <dt>Fases</dt><dd>${inv.phases}</dd>
      <dt>MPPTs</dt><dd>${inv.mppt}</dd>
      <dt>Eficiência</dt><dd>${inv.efficiencyPct}%</dd>
      <dt>Híbrido</dt><dd>${inv.hybrid ? "Sim" : "Não"}</dd>
      <dt>On-grid</dt><dd>${inv.gridTied ? "Sim" : "Não"}</dd>
      <dt>Preço ~</dt><dd>${formatBrl(inv.priceBrlApprox)}</dd>
    </dl>
    <div class="card-actions">
      ${externalLink(inv.productUrl || inv.brandUrl, "Ver no site")}
    </div>
  `;
  return card;
}

function fillBrandSelects() {
  const type = $("#catalog-type")?.value || "stations";
  let brands = [];
  if (type === "panels") brands = state.solar.panels.map((p) => p.brand);
  else if (type === "inverters") brands = state.solar.inverters.map((i) => i.brand);
  else brands = state.data.stations.map((s) => s.brand);

  brands = [...new Set(brands)].sort();

  for (const id of ["filter-brand", "catalog-brand"]) {
    const sel = $(`#${id}`);
    if (!sel) continue;
    const current = sel.value;
    const first = sel.options[0].outerHTML;
    sel.innerHTML = first;
    for (const b of brands) {
      const opt = document.createElement("option");
      opt.value = b;
      opt.textContent = b;
      sel.appendChild(opt);
    }
    if ([...sel.options].some((o) => o.value === current)) sel.value = current;
  }

  const chem = $("#catalog-chem");
  if (chem) chem.disabled = type !== "stations";
}

function fillSolarPanelSelect() {
  const sel = $("#solar-panel-select");
  sel.innerHTML = "";
  for (const p of state.solar.panels) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = `${p.brand} ${p.model} (${p.powerW}W)`;
    sel.appendChild(opt);
  }
  const preferred = state.solar.panels.find((p) => p.powerW >= 500) || state.solar.panels[0];
  if (preferred) sel.value = preferred.id;
}

function getSelectedPanel() {
  const id = $("#solar-panel-select").value;
  return state.solar.panels.find((p) => p.id === id) || state.solar.panels[0];
}

function computeSolar() {
  const dailyWh = Number($("#solar-daily").value) || 0;
  const hsp = Number($("#solar-hsp").value) || 4.5;
  const losses = (Number($("#solar-losses").value) || 20) / 100;
  const margin = (Number($("#solar-margin").value) || 0) / 100;
  const peakW = Number($("#solar-peak").value) || 0;
  const panel = getSelectedPanel();

  const neededWh = dailyWh * (1 + margin) / Math.max(1 - losses, 0.01);
  const energyPerPanelWh = panel.powerW * hsp;
  const panelCount = Math.max(1, Math.ceil(neededWh / Math.max(energyPerPanelWh, 1)));
  const arrayW = panelCount * panel.powerW;
  const inverterMinW = Math.max(arrayW * 0.8, peakW);

  return { dailyWh, neededWh, panel, panelCount, arrayW, inverterMinW, peakW, hsp };
}

function renderSolar() {
  const result = computeSolar();
  $("#s-needed").textContent = formatWh(result.neededWh);
  $("#s-panels").textContent = String(result.panelCount);
  $("#s-array").textContent = formatW(result.arrayW);
  $("#s-inv").textContent = formatW(result.inverterMinW);

  $("#solar-panel-hint").textContent = `${result.panel.type} · ${result.panel.efficiencyPct}% · ~${formatBrl(result.panel.priceBrlApprox * result.panelCount)} no total (${result.panelCount}×)`;

  const link = $("#solar-panel-link");
  const url = result.panel.productUrl || result.panel.brandUrl;
  if (url) {
    link.href = url;
    link.classList.remove("hidden");
    link.textContent = `Ver ${result.panel.brand} no site ↗`;
  } else {
    link.classList.add("hidden");
  }

  const invGrid = $("#solar-inverters");
  invGrid.innerHTML = "";
  const invRanked = state.solar.inverters
    .map((inv) => {
      const powerOk = inv.acPowerW >= result.inverterMinW * 0.9;
      const dcOk = !inv.maxDcW || inv.maxDcW >= result.arrayW * 0.85;
      let fit = "no";
      let label = "Abaixo";
      if (powerOk && dcOk) {
        fit = "ok";
        label = "Adequado";
      } else if (powerOk || dcOk) {
        fit = "partial";
        label = "Parcial";
      }
      const over = inv.acPowerW / Math.max(result.inverterMinW, 1);
      const score = (powerOk ? 80 : inv.acPowerW / Math.max(result.inverterMinW, 1) * 50) + (dcOk ? 20 : 0) - Math.max(0, over - 2) * 8;
      return { inv, meta: { fit, label, score } };
    })
    .sort((a, b) => b.meta.score - a.meta.score);

  for (const item of invRanked.slice(0, 6)) {
    invGrid.appendChild(createInverterCard(item.inv, item.meta));
  }

  const stGrid = $("#solar-stations");
  stGrid.innerHTML = "";
  const stations = [...state.data.stations]
    .map((s) => {
      const solarOk = s.solarInputW >= Math.min(result.arrayW, 2000) * 0.5 || s.solarInputW >= 400;
      const fit = s.solarInputW >= Math.min(result.arrayW, s.solarInputW ? result.arrayW : 1)
        ? "ok"
        : solarOk
          ? "partial"
          : "no";
      const label = fit === "ok" ? "Solar ok" : fit === "partial" ? "Entrada limitada" : "Entrada baixa";
      return { s, meta: { fit, label, score: s.solarInputW } };
    })
    .sort((a, b) => b.meta.score - a.meta.score);

  for (const item of stations.slice(0, 6)) {
    stGrid.appendChild(createStationCard(item.s, item.meta));
  }

  renderSolarCatalog();
}

function renderSolarCatalog() {
  const q = ($("#solar-catalog-search").value || "").trim().toLowerCase();
  const grid = $("#solar-catalog-grid");
  grid.innerHTML = "";

  if (state.solarCat === "panels") {
    const list = state.solar.panels.filter((p) => {
      if (!q) return true;
      return `${p.brand} ${p.model} ${p.type}`.toLowerCase().includes(q);
    });
    const result = computeSolar();
    for (const p of list) {
      const qty = Math.max(1, Math.ceil(result.neededWh / Math.max(p.powerW * result.hsp, 1)));
      grid.appendChild(createPanelCard(p, qty));
    }
  } else if (state.solarCat === "inverters") {
    const list = state.solar.inverters.filter((i) => {
      if (!q) return true;
      return `${i.brand} ${i.model} ${i.type}`.toLowerCase().includes(q);
    });
    for (const i of list) grid.appendChild(createInverterCard(i));
  } else {
    const list = state.data.stations.filter((s) => {
      if (!q) return true;
      return `${s.brand} ${s.model}`.toLowerCase().includes(q);
    });
    for (const s of list) grid.appendChild(createStationCard(s));
  }
}

function renderCatalog() {
  const type = $("#catalog-type").value;
  const q = ($("#catalog-search").value || "").trim().toLowerCase();
  const brand = $("#catalog-brand").value;
  const chem = $("#catalog-chem").value;
  const grid = $("#catalog-grid");
  grid.innerHTML = "";

  fillBrandSelects();

  if (type === "panels") {
    const list = state.solar.panels.filter((p) => {
      if (brand && p.brand !== brand) return false;
      if (!q) return true;
      return `${p.brand} ${p.model} ${p.type}`.toLowerCase().includes(q);
    });
    for (const p of list) grid.appendChild(createPanelCard(p));
    return;
  }

  if (type === "inverters") {
    const list = state.solar.inverters.filter((i) => {
      if (brand && i.brand !== brand) return false;
      if (!q) return true;
      return `${i.brand} ${i.model} ${i.type}`.toLowerCase().includes(q);
    });
    for (const i of list) grid.appendChild(createInverterCard(i));
    return;
  }

  const list = state.data.stations.filter((s) => {
    if (brand && s.brand !== brand) return false;
    if (chem && s.batteryChemistry !== chem) return false;
    if (!q) return true;
    return `${s.brand} ${s.model} ${s.series}`.toLowerCase().includes(q);
  });
  for (const s of list) grid.appendChild(createStationCard(s));
}

function toggleCompare(id) {
  if (state.compareIds.has(id)) state.compareIds.delete(id);
  else {
    if (state.compareIds.size >= 3) {
      alert("Compare no máximo 3 modelos.");
      return;
    }
    state.compareIds.add(id);
  }
  renderCompare();
  renderCatalog();
  renderSolarCatalog();
  if (state.loads.length) renderResults();
  renderSolar();
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
    ["Site", (s) => s.productUrl || s.brandUrl || "—"],
    ["Notas", (s) => s.notes || "—"],
  ];

  wrap.innerHTML = `
    <table class="compare">
      <tbody>
        ${rows
          .map(([label, fn]) => {
            if (label === "Site") {
              return `
              <tr>
                <th>${label}</th>
                ${stations
                  .map((s) => {
                    const url = s.productUrl || s.brandUrl;
                    return url
                      ? `<td><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(hostnameOf(url))} ↗</a></td>`
                      : `<td>—</td>`;
                  })
                  .join("")}
              </tr>`;
            }
            return `
            <tr>
              <th>${label}</th>
              ${stations.map((s) => `<td>${escapeHtml(String(fn(s)))}</td>`).join("")}
            </tr>`;
          })
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

  $$(".subtab").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.solarCat = btn.dataset.solarCat;
      $$(".subtab").forEach((b) => b.classList.toggle("active", b === btn));
      renderSolarCatalog();
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

  ["catalog-search", "catalog-brand", "catalog-chem", "catalog-type"].forEach((id) => {
    $(`#${id}`).addEventListener("input", renderCatalog);
    $(`#${id}`).addEventListener("change", renderCatalog);
  });

  ["solar-daily", "solar-hsp", "solar-losses", "solar-margin", "solar-peak", "solar-panel-select"].forEach((id) => {
    $(`#${id}`).addEventListener("input", renderSolar);
    $(`#${id}`).addEventListener("change", renderSolar);
  });

  $("#solar-catalog-search").addEventListener("input", renderSolarCatalog);

  $("#solar-import-loads").addEventListener("click", () => {
    if (!state.loads.length) {
      alert("Adicione cargas na aba Baterias primeiro.");
      return;
    }
    const sizing = computeSizing();
    $("#solar-daily").value = Math.round(sizing.dailyWh);
    $("#solar-peak").value = Math.round(Math.max(sizing.continuousW, sizing.surgeW));
    renderSolar();
  });
}

async function init() {
  setupTabs();
  setupForms();
  await loadData();
  fillBrandSelects();
  fillSolarPanelSelect();
  renderPresets();
  renderLoads();
  renderResults();
  renderCatalog();
  renderCompare();
  renderSolar();
}

init().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML(
    "afterbegin",
    `<p style="background:#400;color:#fff;padding:1rem;margin:0">Erro ao iniciar: ${escapeHtml(err.message)}</p>`
  );
});
