import './layout.js';
import { api } from './api.js';
import { h, $, $$, clear, cssVar, reducedMotion } from './dom.js';
import { windrose } from './windrose.js';
import { fmt, fmtMonth, fmtDate, fixtureChip, dirLabel } from './labels.js';

const select = $('#zone-select'), stage = $('#stage'), empty = $('#empty');
let main, sub, fc;
let currentGroup = 'pelagis_besar';
let oceanHorizon = 3;

const baseOpts = () => ({
  responsive: true, maintainAspectRatio: false, animation: reducedMotion() ? false : { duration: 600 },
  plugins: { legend: { labels: { color: cssVar('--text'), font: { family: cssVar('--font-ui').split(',')[0].replace(/'/g, '') }, filter: (i) => !i.text.startsWith('_') } } },
  scales: {
    x: { ticks: { color: cssVar('--text-muted') }, grid: { color: cssVar('--line') } },
    y: { ticks: { color: cssVar('--text-muted') }, grid: { color: cssVar('--line') } }
  }
});

function drawMain(f) {
  // Rentang 1 tahun ke belakang (12 bulan historis + bulan-bulan forecast)
  const isH = (x) => x.kind === 'hindcast';
  const hindcasts = f.series.filter(isH);
  const forecasts = f.series.filter((x) => x.kind === 'forecast');
  const s = [...hindcasts.slice(-12), ...forecasts];
  const lastH = hindcasts.at(-1);
  const copper = cssVar('--copper');
  const labels = s.map((x) => x.month);

  const actualData = s.map((x) => (isH(x) ? (x.by_group?.[currentGroup]?.actual_catch ?? x.actual_catch) : null));
  const msyData = s.map((x) => (x.by_group?.[currentGroup]?.msy ?? x.msy));
  const tacData = s.map((x) => (x.by_group?.[currentGroup]?.tac ?? x.tac ?? (x.by_group?.[currentGroup]?.msy ? Number((x.by_group[currentGroup].msy * 0.8).toFixed(1)) : null)));
  const lastAct = lastH?.by_group?.[currentGroup]?.actual_catch ?? lastH?.actual_catch ?? null;
  const fore = s.map((x) => (x.kind === 'forecast' ? (x.by_group?.[currentGroup]?.hindcast ?? x.hindcast) : x.month === lastH?.month ? lastAct : null));

  main?.destroy();
  const o = baseOpts();
  o.scales.y.title = { display: true, text: 'ton/bulan', color: cssVar('--text-muted') };
  main = new Chart($('#main-chart'), {
    type: 'line',
    data: { labels, datasets: [
      { label: 'Tangkapan aktual', data: actualData, borderColor: cssVar('--sand'), borderWidth: 2, pointRadius: 3, tension: 0 },
      { label: 'Forecast', data: fore, borderColor: copper, borderWidth: 2.5, pointRadius: 4, pointBackgroundColor: copper, tension: 0 },
      { label: 'MSY', data: msyData, borderColor: cssVar('--taupe'), borderDash: [2, 4], borderWidth: 1.5, pointRadius: 0, tension: 0 },
      { label: 'TAC (Batas Tangkap Diperbolehkan)', data: tacData, borderColor: cssVar('--abund-high'), borderDash: [6, 4], borderWidth: 1.5, pointRadius: 0, tension: 0 }
    ] },
    options: o
  });

  const msyVal = s.at(-1)?.by_group?.[currentGroup]?.msy ?? s.at(-1)?.msy;
  const tacVal = s.at(-1)?.by_group?.[currentGroup]?.tac ?? s.at(-1)?.tac ?? (msyVal ? msyVal * 0.8 : null);
  const metricList = [
    ['MSY (Batas Lestari)', `${fmt(msyVal, 2)} ton/bulan`],
    ['TAC (Batas Diperbolehkan)', `${fmt(tacVal, 2)} ton/bulan`]
  ];
  forecasts.forEach((fcItem) => {
    const val = fcItem.by_group?.[currentGroup]?.hindcast ?? fcItem.hindcast;
    metricList.push([`Forecast ${fmtMonth(fcItem.month)}`, `${fmt(val, 2)} ton`]);
  });

  $('#metrics').replaceChildren(...metricList.map(([k, v]) => h('div', {}, h('dt', {}, k), h('dd', {}, v))));
  $('#fixture-mark').replaceChildren(f.is_fixture ? fixtureChip() : '');
}

function drawSub(tab) {
  const pDaily = (fc.params_daily && fc.params_daily.length) ? fc.params_daily : (fc.params ?? []).slice(-30);
  const pForecast = (fc.params_forecast || []).slice(0, oceanHorizon);
  const cfg = { chl: ['chl', 'Klorofil-a (mg/m³)', 3], sst: ['sst', 'SST (°C)', 3], current: ['speed', 'Kecepatan arus (m/s)', 3] }[tab];

  const dailyLabels = pDaily.map((x) => (x.date ? `${x.date.slice(8)}/${x.date.slice(5, 7)}` : x.month));
  const forecastLabels = pForecast.map((x) => (x.date ? `${x.date.slice(8)}/${x.date.slice(5, 7)} (H+${x.day_offset})` : `H+${x.day_offset}`));
  const labels = [...dailyLabels, ...forecastLabels];

  // Data observasi
  const observedData = [
    ...pDaily.map((x) => (x[cfg[0]] != null ? Number(Number(x[cfg[0]]).toFixed(3)) : null)),
    ...pForecast.map(() => null)
  ];

  // Data prediksi (titik awal tersambung dengan titik observasi terakhir)
  const lastObsVal = pDaily.length ? pDaily.at(-1)[cfg[0]] : null;
  const forecastData = pDaily.map((x, i) => (i === pDaily.length - 1 && lastObsVal != null ? Number(Number(lastObsVal).toFixed(3)) : null));
  forecastData.push(...pForecast.map((x) => (x[cfg[0]] != null ? Number(Number(x[cfg[0]]).toFixed(3)) : null)));

  sub?.destroy();
  const o = baseOpts();
  o.plugins.legend.display = true;
  o.scales.y.title = { display: true, text: cfg[1], color: cssVar('--text-muted') };
  o.scales.y.ticks = {
    color: cssVar('--text-muted'),
    callback: (v) => Number(v).toFixed(3)
  };
  o.plugins.tooltip = {
    callbacks: {
      label: (ctx) => `${ctx.dataset.label}: ${Number(ctx.parsed.y).toFixed(3)}`
    }
  };

  const datasets = [
    {
      label: 'Data terukur',
      data: observedData,
      borderColor: cssVar('--sand'),
      borderWidth: 2,
      pointRadius: 2.5,
      tension: 0
    }
  ];

  if (pForecast.length > 0) {
    datasets.push({
      label: `Prediksi (+${oceanHorizon} hari)`,
      data: forecastData,
      borderColor: cssVar('--copper'),
      borderDash: [5, 4],
      borderWidth: 2.5,
      pointRadius: 4,
      pointBackgroundColor: cssVar('--copper'),
      tension: 0
    });
  }

  sub = new Chart($('#sub-chart'), {
    type: 'line',
    data: {
      labels,
      datasets
    },
    options: o
  });

  $('#sub-title').textContent = `${cfg[1]} (30 Hari Terakhir + Prediksi ${oceanHorizon} Hari)`;
  const wr = $('#windrose'); clear(wr);
  if (tab === 'current') {
    const last = pForecast.length ? pForecast.at(-1) : pDaily.at(-1);
    if (last) {
      const dateLabel = last.date ? `${last.date.slice(8)}/${last.date.slice(5, 7)}/${last.date.slice(0, 4)}` : fmtMonth(last.month);
      const prefix = last.day_offset ? `Prakiraan H+${last.day_offset}: ` : '';
      wr.append(windrose(last.direction_deg, last.direction_label), h('p', { class: 'mono', style: 'text-align:center;font-size:14px' }, `${prefix}${last.direction_label}, ${last.direction_deg}° (${dateLabel})`));
    }
  }
}

async function load(zoneId) {
  if (!zoneId) { stage.hidden = true; empty.hidden = false; return; }
  try {
    fc = await api(`/forecast/${zoneId}`);
    empty.hidden = true; stage.hidden = false;
    drawMain(fc);
    drawSub($('.param-tab[aria-selected="true"]')?.dataset.tab ?? 'chl');
  } catch (e) { stage.hidden = true; empty.hidden = false; empty.textContent = e.message; }
}

$$('.fish-tab').forEach((t) => t.addEventListener('click', () => {
  $$('.fish-tab').forEach((x) => x.setAttribute('aria-selected', String(x === t)));
  currentGroup = t.dataset.group;
  if (fc) drawMain(fc);
}));

$$('.param-tab').forEach((t) => t.addEventListener('click', () => {
  $$('.param-tab').forEach((x) => x.setAttribute('aria-selected', String(x === t)));
  if (fc) drawSub(t.dataset.tab);
}));

$$('.horizon-tab').forEach((t) => t.addEventListener('click', () => {
  $$('.horizon-tab').forEach((x) => x.setAttribute('aria-selected', String(x === t)));
  oceanHorizon = Number(t.dataset.days);
  if (fc) drawSub($('.param-tab[aria-selected="true"]')?.dataset.tab ?? 'chl');
}));
select.addEventListener('change', () => load(select.value));

(async () => {
  try {
    const z = await api('/zones');
    z.features.forEach((f) => select.append(h('option', { value: f.properties.zone_id }, `${f.properties.zone_id} ${f.properties.name}`)));
  } catch (e) { empty.textContent = e.message; }
})();
