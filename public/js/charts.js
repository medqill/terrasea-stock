import './layout.js';
import { api } from './api.js';
import { h, $, $$, clear, cssVar, reducedMotion } from './dom.js';
import { windrose } from './windrose.js';
import { fmt, fmtMonth, fmtDate, fixtureChip, dirLabel } from './labels.js';

const select = $('#zone-select'), stage = $('#stage'), empty = $('#empty');
let main, sub, radar, fc;
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

function createSparkline(values, width = 44, height = 16) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'fish-tab__spark');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('aria-hidden', 'true');

  if (!values || values.length < 2) return svg;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = (max - min) || 1;
  const pad = 2;
  const w = width - pad * 2;
  const h = height - pad * 2;

  const points = values.map((v, i) => {
    const x = (pad + (i / (values.length - 1)) * w).toFixed(1);
    const y = (height - pad - ((v - min) / range) * h).toFixed(1);
    return `${x},${y}`;
  }).join(' ');

  const polyline = document.createElementNS(ns, 'polyline');
  polyline.setAttribute('points', points);
  polyline.setAttribute('fill', 'none');
  polyline.setAttribute('stroke', 'currentColor');
  polyline.setAttribute('stroke-width', '1.5');
  polyline.setAttribute('stroke-linecap', 'round');
  polyline.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(polyline);
  return svg;
}

function renderTrendPill(diffPct) {
  let cls = 'trend-pill--flat';
  let sym = '=';
  let prefix = '';
  if (diffPct >= 3) {
    cls = 'trend-pill--up';
    sym = '▲';
    prefix = '+';
  } else if (diffPct <= -3) {
    cls = 'trend-pill--down';
    sym = '▼';
  }
  return h('span', { class: `trend-pill ${cls}` }, `${sym} ${prefix}${diffPct}%`);
}

function updateFishTabsTrends(f) {
  const hindcasts = f.series.filter(x => x.kind === 'hindcast');
  const forecasts = f.series.filter(x => x.kind === 'forecast');
  const recent6 = hindcasts.slice(-6);

  ['pelagis_besar', 'pelagis_kecil', 'demersal'].forEach((groupKey) => {
    const metaEl = $(`#tab-meta-${groupKey}`);
    if (!metaEl) return;
    
    const getCatch = (item) => item.by_group?.[groupKey]?.actual_catch ?? item.actual_catch ?? 0;
    const getForecast = (item) => item.by_group?.[groupKey]?.hindcast ?? item.hindcast ?? 0;
    
    const historyValues = recent6.map(getCatch);
    const forecastVal = forecasts.length > 0 ? getForecast(forecasts[0]) : (historyValues.at(-1) || 0);
    const sparkValues = [...historyValues, forecastVal];

    const past3 = historyValues.slice(-3);
    const avgPast3 = past3.length ? (past3.reduce((a, b) => a + b, 0) / past3.length) : 0;
    const diffPct = avgPast3 > 0 ? Math.round(((forecastVal - avgPast3) / avgPast3) * 100) : 0;

    const sparkEl = createSparkline(sparkValues, 44, 16);
    const pillEl = renderTrendPill(diffPct);
    metaEl.replaceChildren(sparkEl, pillEl);
  });
}

function computeEcosystemScores(f, groupKey) {
  const hindcasts = f.series.filter(x => x.kind === 'hindcast');
  const forecasts = f.series.filter(x => x.kind === 'forecast');
  const recentHindcasts = hindcasts.slice(-12);

  const getCatch = (item) => item.by_group?.[groupKey]?.actual_catch ?? item.actual_catch ?? 0;
  const getForecast = (item) => item.by_group?.[groupKey]?.hindcast ?? item.hindcast ?? 0;
  const getTac = (item) => item.by_group?.[groupKey]?.tac ?? item.tac ?? (item.by_group?.[groupKey]?.msy ? item.by_group[groupKey].msy * 0.8 : 50);

  // 1. Kelimpahan Stok
  const avgHistoricalCatch = recentHindcasts.reduce((acc, cur) => acc + getCatch(cur), 0) / (recentHindcasts.length || 1);
  const latestForecast = forecasts.length > 0 ? getForecast(forecasts[0]) : avgHistoricalCatch;
  let stockScore = 75;
  if (avgHistoricalCatch > 0) {
    const ratio = latestForecast / avgHistoricalCatch;
    stockScore = Math.round(Math.min(100, Math.max(20, ratio * 75)));
  }

  // 2. Klorofil-a / Nutrien
  const pDaily = (f.params_daily && f.params_daily.length) ? f.params_daily : (f.params || []).slice(-30);
  const chlValues = pDaily.map(p => p.chl).filter(v => v != null && !isNaN(v));
  const avgChl = chlValues.length ? (chlValues.reduce((a, b) => a + b, 0) / chlValues.length) : 0.6;
  let chlScore = Math.round(Math.min(100, Math.max(25, avgChl * 70 + 20)));

  // 3. Stabilitas Suhu / SST
  const sstValues = pDaily.map(p => p.sst).filter(v => v != null && !isNaN(v));
  const avgSst = sstValues.length ? (sstValues.reduce((a, b) => a + b, 0) / sstValues.length) : 28.5;
  const idealSst = 28.7;
  const sstDiff = Math.abs(avgSst - idealSst);
  let sstScore = Math.round(Math.min(100, Math.max(30, 100 - (sstDiff * 25))));

  // 4. Kondisi Arus
  const speedValues = pDaily.map(p => p.speed).filter(v => v != null && !isNaN(v));
  const avgSpeed = speedValues.length ? (speedValues.reduce((a, b) => a + b, 0) / speedValues.length) : 0.2;
  let currentScore = 85;
  if (avgSpeed <= 0.35) {
    currentScore = Math.round(95 - (avgSpeed * 30));
  } else {
    currentScore = Math.round(Math.max(25, 95 - ((avgSpeed - 0.35) * 150)));
  }

  // 5. Margin Kuota TAC
  const currentTac = forecasts.length > 0 ? getTac(forecasts[0]) : (recentHindcasts.at(-1) ? getTac(recentHindcasts.at(-1)) : 50);
  let quotaScore = 75;
  if (currentTac > 0) {
    const usageRatio = latestForecast / currentTac;
    if (usageRatio <= 0.8) {
      quotaScore = Math.round(85 + (1 - usageRatio) * 15);
    } else if (usageRatio <= 1.0) {
      quotaScore = Math.round(65 + (1 - usageRatio) * 75);
    } else {
      quotaScore = Math.round(Math.max(20, 60 - (usageRatio - 1) * 80));
    }
  }

  const compositeScore = Math.round((stockScore + chlScore + sstScore + currentScore + quotaScore) / 5);

  return {
    stockScore,
    chlScore,
    sstScore,
    currentScore,
    quotaScore,
    compositeScore,
    avgChl: avgChl.toFixed(2),
    avgSst: avgSst.toFixed(1),
    avgSpeed: avgSpeed.toFixed(2),
    latestForecast: fmt(latestForecast, 2),
    currentTac: fmt(currentTac, 2)
  };
}

const groupNameMap = {
  pelagis_besar: 'Pelagis Besar',
  pelagis_kecil: 'Pelagis Kecil',
  demersal: 'Demersal'
};

function renderRadarSummary(scores, groupKey) {
  const groupLabel = groupNameMap[groupKey] || 'Kelompok Ikan';
  const badgeEl = $('#radar-health-badge');
  const numEl = $('#radar-composite-num');
  const descEl = $('#radar-composite-desc');
  const listEl = $('#radar-metrics-list');

  if (numEl) numEl.textContent = String(scores.compositeScore);

  let badgeText = '= Kondisi Moderat';
  let badgeCol = cssVar('--abund-mid');
  let descText = `Kondisi perairan berada pada tingkat moderat (${scores.compositeScore}/100). Rata-rata suhu permukaan laut ${scores.avgSst} °C dan klorofil ${scores.avgChl} mg/m³. Pemantauan kuota tangkap ${groupLabel} disarankan.`;

  if (scores.compositeScore >= 70) {
    badgeText = '▲ Kondisi Sangat Baik';
    badgeCol = cssVar('--abund-high');
    descText = `Kondisi perairan zona ini berada pada indeks prima (${scores.compositeScore}/100). Nutrien klorofil rata-rata ${scores.avgChl} mg/m³, suhu permukaan laut ${scores.avgSst} °C, serta margin kuota ${groupLabel} terjaga aman dari ambang batas TAC.`;
  } else if (scores.compositeScore < 50) {
    badgeText = '▼ Perlu Waspada';
    badgeCol = cssVar('--abund-low');
    descText = `Indeks komposit menunjukkan tekanan lingkungan atau pemanfaatan (${scores.compositeScore}/100). Prakiraan tangkapan ${groupLabel} (${scores.latestForecast} ton) mendekati kuota TAC (${scores.currentTac} ton).`;
  }

  if (badgeEl) {
    badgeEl.textContent = badgeText;
    badgeEl.style.color = badgeCol;
    badgeEl.style.borderColor = badgeCol;
  }
  if (descEl) descEl.textContent = descText;

  if (listEl) {
    const metricDefs = [
      {
        label: 'Kelimpahan Stok',
        score: scores.stockScore,
        desc: `Prakiraan ${scores.latestForecast} ton`
      },
      {
        label: 'Klorofil-a (Nutrien)',
        score: scores.chlScore,
        desc: `Rata-rata: ${scores.avgChl} mg/m³`
      },
      {
        label: 'Stabilitas Suhu (SST)',
        score: scores.sstScore,
        desc: `Rata-rata: ${scores.avgSst} °C`
      },
      {
        label: 'Kondisi Arus',
        score: scores.currentScore,
        desc: `Kecepatan: ${scores.avgSpeed} m/s`
      },
      {
        label: 'Margin Kuota (TAC)',
        score: scores.quotaScore,
        desc: `Batas TAC: ${scores.currentTac} ton`
      }
    ];

    const cards = metricDefs.map((m) => {
      const col = m.score >= 70 ? 'var(--abund-high)' : m.score >= 50 ? 'var(--abund-mid)' : 'var(--abund-low)';
      const sym = m.score >= 70 ? '▲' : m.score >= 50 ? '=' : '▼';
      return h('div', { class: 'radar-metric-item' },
        h('div', { class: 'radar-metric-item__header' },
          h('span', { class: 'radar-metric-item__label' }, m.label),
          h('span', { class: 'radar-metric-item__val', style: `color:${col}` }, `${sym} ${m.score}`)
        ),
        h('div', { class: 'radar-metric-item__bar' },
          h('div', { class: 'radar-metric-item__bar-fill', style: `width:${m.score}%;background:${col}` })
        ),
        h('span', { class: 'radar-metric-item__desc' }, m.desc)
      );
    });

    listEl.replaceChildren(...cards);
  }
}

function drawRadar(f, groupKey) {
  const scores = computeEcosystemScores(f, groupKey);
  const labels = [
    'Kelimpahan Stok',
    'Klorofil (Nutrien)',
    'Stabilitas Suhu',
    'Kondisi Arus',
    'Margin Kuota TAC'
  ];
  const dataValues = [
    scores.stockScore,
    scores.chlScore,
    scores.sstScore,
    scores.currentScore,
    scores.quotaScore
  ];

  radar?.destroy();
  const canvasEl = $('#radar-chart');
  if (!canvasEl) return;

  const fontFam = cssVar('--font-ui').split(',')[0].replace(/'/g, '');

  radar = new Chart(canvasEl, {
    type: 'radar',
    data: {
      labels,
      datasets: [{
        label: 'Skor Normalisasi (%)',
        data: dataValues,
        backgroundColor: 'rgba(181, 136, 99, 0.22)',
        borderColor: cssVar('--copper'),
        borderWidth: 2,
        pointBackgroundColor: cssVar('--copper'),
        pointBorderColor: cssVar('--surface'),
        pointHoverBackgroundColor: cssVar('--sand'),
        pointHoverBorderColor: cssVar('--copper'),
        pointRadius: 4,
        pointHoverRadius: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: reducedMotion() ? false : { duration: 500 },
      scales: {
        r: {
          min: 0,
          max: 100,
          ticks: {
            display: false,
            stepSize: 20,
            backdropColor: 'transparent'
          },
          grid: {
            color: cssVar('--line') || 'rgba(211, 195, 185, 0.18)'
          },
          angleLines: {
            color: cssVar('--line') || 'rgba(211, 195, 185, 0.18)'
          },
          pointLabels: {
            color: cssVar('--sand'),
            font: {
              family: fontFam,
              size: 11,
              weight: '600'
            }
          }
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.label}: ${ctx.raw} / 100`
          }
        }
      }
    }
  });

  renderRadarSummary(scores, groupKey);
}

async function load(zoneId) {
  if (!zoneId) { stage.hidden = true; empty.hidden = false; return; }
  try {
    fc = await api(`/forecast/${zoneId}`);
    empty.hidden = true; stage.hidden = false;
    drawMain(fc);
    drawSub($('.param-tab[aria-selected="true"]')?.dataset.tab ?? 'chl');
    updateFishTabsTrends(fc);
    drawRadar(fc, currentGroup);
  } catch (e) { stage.hidden = true; empty.hidden = false; empty.textContent = e.message; }
}

$$('.fish-tab').forEach((t) => t.addEventListener('click', () => {
  $$('.fish-tab').forEach((x) => x.setAttribute('aria-selected', String(x === t)));
  currentGroup = t.dataset.group;
  if (fc) {
    drawMain(fc);
    drawRadar(fc, currentGroup);
  }
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
