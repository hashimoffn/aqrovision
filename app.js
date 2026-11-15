const $ = id => document.getElementById(id);
const LS = 'aqrovision_fields';
const MONTHS = ['Yan','Fev','Mar','Apr','May','İyn','İyl','Avq','Sen','Okt','Noy','Dek'];
const DAYS = ['Bazar','B.e.','Ç.a.','Çərşənbə','C.a.','Cümə','Şənbə'];
const S = { fields: [], sel: null, mode: 'point', pts: [], past: null, fc: null, tab: 'moist', charts: {} };
try { S.fields = JSON.parse(localStorage.getItem(LS) || '[]'); } catch (e) {}

const fmtD = s => { const d = new Date(s + 'T00:00:00'); return d.getDate() + ' ' + MONTHS[d.getMonth()]; };
const num = (v, n = 0) => v == null ? '—' : (+v).toFixed(n);
const avg = a => { a = a.filter(v => v != null); return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null; };
const wx = c => c === 0 ? ['Aydın', '☀'] : c <= 2 ? ['Az buludlu', '🌤'] : c === 3 ? ['Buludlu', '☁'] : c <= 48 ? ['Dumanlı', '🌫'] : c <= 67 ? ['Yağışlı', '🌧'] : c <= 77 ? ['Qarlı', '❄'] : c <= 82 ? ['Leysan', '🌦'] : ['Tufanlı', '⛈'];

/* ---------- Xəritə ---------- */
const EMPTY_TILE_DATA_URL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const map = L.map('map', { maxZoom: 19, minZoom: 3 }).setView([40.4, 47.9], 7);
const satFallback = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxNativeZoom: 15, maxZoom: 19, errorTileUrl: EMPTY_TILE_DATA_URL, attribution: 'Esri' }).addTo(map);
const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxNativeZoom: 18, maxZoom: 19, attribution: '© OpenStreetMap' });
const sat = L.tileLayer('https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', { subdomains: ['mt0', 'mt1', 'mt2', 'mt3'], maxNativeZoom: 17, maxZoom: 19, errorTileUrl: EMPTY_TILE_DATA_URL, attribution: 'Google' });
sat.addTo(map);
[sat, satFallback].forEach(layer => layer.on('tileerror', e => { if (e && e.tile) e.tile.style.display = 'none'; }));
L.control.layers({ 'Peyk': sat, 'Xəritə': osm }).addTo(map);
const draw = L.layerGroup().addTo(map), tmp = L.layerGroup().addTo(map);

function area(p) { // sferik sahə, hektar
  const R = 6378137, r = Math.PI / 180; let s = 0;
  p.forEach((a, i) => { const b = p[(i + 1) % p.length]; s += (b[1] - a[1]) * r * (2 + Math.sin(a[0] * r) + Math.sin(b[0] * r)); });
  return Math.abs(s * R * R / 2) / 1e4;
}
function hint(t) { $('mapHint').textContent = t; }
function setMode(m) {
  S.mode = m; S.pts = []; tmp.clearLayers();
  $('modePoint').classList.toggle('active', m === 'point');
  $('modePoly').classList.toggle('active', m === 'poly');
  hint(m === 'point' ? 'Xəritədə klikləyin.' : 'Sahənin künclərini ardıcıl klikləyin, sonda “Bitir” düyməsini basın.');
}
function select(t, move = true) {
  S.sel = t; draw.clearLayers(); $('selName').textContent = t.name;
  if (t.poly) {
    const pg = L.polygon(t.poly, { color: '#173D2B', fillColor: '#4F8B55', fillOpacity: .35 }).addTo(draw);
    if (move) map.fitBounds(pg.getBounds(), { maxZoom: 16 });
  } else {
    L.marker([t.lat, t.lng]).addTo(draw);
    if (move) map.setView([t.lat, t.lng], Math.max(map.getZoom(), 10));
  }
  renderList(); load();
}
map.on('click', e => {
  const { lat, lng } = e.latlng;
  if (S.mode === 'point') return select({ name: `Nöqtə ${lat.toFixed(3)}, ${lng.toFixed(3)}`, lat, lng }, false);
  S.pts.push([lat, lng]); tmp.clearLayers();
  S.pts.forEach(p => L.circleMarker(p, { radius: 4, color: '#173D2B' }).addTo(tmp));
  if (S.pts.length > 1) L.polyline(S.pts, { color: '#D9A441' }).addTo(tmp);
});
$('modePoint').onclick = () => setMode('point');
$('modePoly').onclick = () => setMode('poly');
$('finishBtn').onclick = () => {
  if (S.pts.length < 3) return hint('Sahə üçün ən azı 3 nöqtə lazımdır.');
  const p = S.pts.slice(), lat = avg(p.map(x => x[0])), lng = avg(p.map(x => x[1]));
  tmp.clearLayers(); S.pts = [];
  select({ name: 'Çəkilmiş sahə', lat, lng, poly: p, area: area(p) }, false); setMode('point');
};
$('clearBtn').onclick = () => { S.pts = []; tmp.clearLayers(); draw.clearLayers(); hint('Təmizləndi.'); };
$('locBtn').onclick = () => navigator.geolocation
  ? navigator.geolocation.getCurrentPosition(p => select({ name: 'Mənim yerim', lat: p.coords.latitude, lng: p.coords.longitude }), () => hint('Məkan icazəsi verilmədi.'))
  : hint('Brauzer məkanı dəstəkləmir.');
$('search').addEventListener('keydown', async e => {
  if (e.key !== 'Enter' || !e.target.value.trim()) return;
  try {
    const r = await (await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(e.target.value))).json();
    if (!r.length) return hint('Yer tapılmadı.');
    map.setView([+r[0].lat, +r[0].lon], 12); hint(r[0].display_name + ' — indi xəritədə sahəni seçin.');
  } catch (err) { hint('Axtarış alınmadı.'); }
});
$('saveBtn').onclick = () => {
  if (!S.sel) return hint('Əvvəl sahə seçin.');
  const name = prompt('Sahənin adı:', S.sel.name); if (!name) return;
  S.sel = { ...S.sel, name, id: Date.now() };
  S.fields.push(S.sel); localStorage.setItem(LS, JSON.stringify(S.fields));
  $('selName').textContent = name; renderList();
};
function renderList() {
  const ul = $('fieldList');
  if (!S.fields.length) { ul.innerHTML = '<li class="empty">Hələ sahə yadda saxlanmayıb</li>'; return; }
  ul.innerHTML = '';
  S.fields.forEach(f => {
    const li = document.createElement('li'); li.className = S.sel && S.sel.id === f.id ? 'on' : '';
    li.innerHTML = `<span>▧ ${f.name.replace(/</g, '&lt;')}</span><small>${f.area ? f.area.toFixed(1) + ' ha' : 'nöqtə'}</small><button title="Sil">✕</button>`;
    li.onclick = () => select(f);
    li.querySelector('button').onclick = ev => {
      ev.stopPropagation(); S.fields = S.fields.filter(x => x.id !== f.id);
      localStorage.setItem(LS, JSON.stringify(S.fields)); renderList();
    };
    ul.appendChild(li);
  });
}

/* ---------- Məlumat (NASA POWER) ---------- */
const ymd = d => d.toISOString().slice(0, 10).replace(/-/g, '');
const iso = s => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
function note(t, err) { const n = $('notice'); n.hidden = !t; n.textContent = t || ''; n.classList.toggle('err', !!err); }

function getDayOfYear(dateObj) {
  const start = new Date(Date.UTC(dateObj.getUTCFullYear(), 0, 0));
  return Math.floor((dateObj.getTime() - start.getTime()) / 864e5);
}

function et0Hargreaves(tMin, tMax, tMean, latDeg, dayOfYear) {
  const phi = (latDeg * Math.PI) / 180;
  const dr = 1 + 0.033 * Math.cos(((2 * Math.PI) / 365) * dayOfYear);
  const delta = 0.409 * Math.sin(((2 * Math.PI) / 365) * dayOfYear - 1.39);
  const ws = Math.acos(Math.max(-1, Math.min(1, -Math.tan(phi) * Math.tan(delta))));
  const ra = ((24 * 60) / Math.PI) * 0.0820 * dr * (ws * Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta) * Math.sin(ws));
  const td = Math.max(2, (tMax ?? 22) - (tMin ?? 12));
  const tm = tMean ?? ((tMax ?? 22) + (tMin ?? 12)) / 2;
  const et0 = 0.0023 * (ra / 2.45) * (tm + 17.8) * Math.sqrt(td);
  return Math.max(0.4, +et0.toFixed(2));
}

function deriveNasaWeatherCode(rainMm, rhPct, tMax, tMin) {
  const r = rainMm || 0, rh = rhPct || 55, tAvg = ((tMax ?? 20) + (tMin ?? 10)) / 2;
  if (tAvg <= 1 && r >= 1.5) return 73;
  if (r >= 12) return 95;
  if (r >= 4) return 63;
  if (r >= 0.8) return 61;
  if (r >= 0.2) return 51;
  if (rh >= 86) return 45;
  if (rh >= 68) return 2;
  return 0;
}

function forwardFillSeries(arr, fallbackVal) {
  const out = arr.slice();
  let last = null;
  for (let i = 0; i < out.length; i++) {
    if (out[i] != null && !isNaN(out[i])) last = out[i];
    else if (last != null) out[i] = last;
  }
  let first = last ?? fallbackVal;
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i] != null && !isNaN(out[i])) first = out[i];
    else out[i] = first;
  }
  return out;
}

async function fetchNasaAllData(t, N) {
  const candidates = [
    new Date(Date.now() - 2 * 864e5),
    new Date('2026-04-12T12:00:00Z'),
    new Date('2026-03-01T12:00:00Z'),
    new Date('2025-12-31T12:00:00Z')
  ];
  const windowDays = Math.max(N + 35, 120);
  const P = 'T2M,T2M_MAX,T2M_MIN,PRECTOTCORR,GWETTOP,GWETROOT,GWETPROF,TS,RH2M,WS10M,WS10M_MAX';

  for (const endObj of candidates) {
    const startObj = new Date(endObj.getTime() - windowDays * 864e5);
    try {
      const u = `https://power.larc.nasa.gov/api/temporal/daily/point?parameters=${P}&community=AG&longitude=${t.lng.toFixed(4)}&latitude=${t.lat.toFixed(4)}&start=${ymd(startObj)}&end=${ymd(endObj)}&format=JSON`;
      const r = await fetch(u);
      if (!r.ok) continue;
      const p = (await r.json()).properties.parameter;
      const keys = Object.keys(p.T2M).sort();
      const g = k => keys.map(d => { const v = p[k] ? p[k][d] : null; return v == null || v <= -990 ? null : v; });
      const raw = {
        dates: keys.map(iso), T: g('T2M'), Tmax: g('T2M_MAX'), Tmin: g('T2M_MIN'),
        rain: g('PRECTOTCORR'), top: g('GWETTOP'), root: g('GWETROOT'), prof: g('GWETPROF'),
        ts: g('TS'), rh: g('RH2M'), ws: g('WS10M'), wsMax: g('WS10M_MAX')
      };
      let lastValidIdx = -1;
      for (let i = raw.dates.length - 1; i >= 0; i--) {
        if (raw.root[i] != null || raw.T[i] != null) { lastValidIdx = i; break; }
      }
      if (lastValidIdx < 0) continue;
      const sliceEnd = lastValidIdx + 1, sliceStart = Math.max(0, sliceEnd - N);
      const dates = raw.dates.slice(sliceStart, sliceEnd);
      const T = forwardFillSeries(raw.T.slice(sliceStart, sliceEnd), 18.5);
      const Tmax = forwardFillSeries(raw.Tmax.slice(sliceStart, sliceEnd), 24.0);
      const Tmin = forwardFillSeries(raw.Tmin.slice(sliceStart, sliceEnd), 13.0);
      const rain = raw.rain.slice(sliceStart, sliceEnd).map(v => (v == null || v < 0 ? 0 : +v.toFixed(2)));
      const top = forwardFillSeries(raw.top.slice(sliceStart, sliceEnd), 0.42);
      const root = forwardFillSeries(raw.root.slice(sliceStart, sliceEnd), 0.48);
      const prof = forwardFillSeries(raw.prof.slice(sliceStart, sliceEnd), 0.51);
      const ts = forwardFillSeries(raw.ts.slice(sliceStart, sliceEnd), 17.5);
      const rh = forwardFillSeries(raw.rh.slice(sliceStart, sliceEnd), 58);
      const ws = forwardFillSeries(raw.ws.slice(sliceStart, sliceEnd), 3.4);
      const wsMax = forwardFillSeries(raw.wsMax.slice(sliceStart, sliceEnd), 5.6);

      const past = { dates, T, Tmax, Tmin, rain, top, root, prof, ts, rh, ws, wsMax };
      const lastI = dates.length - 1;
      const anchorDate = new Date(dates[lastI] + 'T12:00:00Z');
      const fcTimes = [], fcCodes = [], fcTmax = [], fcTmin = [], fcRain = [], fcRainProb = [], fcWindMax = [], fcEt0 = [], s0 = [], s1 = [], s2 = [], t0 = [], t6 = [];
      let curTop = top[lastI], curRoot = root[lastI], curProf = prof[lastI];
      for (let dIdx = 0; dIdx < 7; dIdx++) {
        const dt = new Date(anchorDate.getTime() + dIdx * 864e5);
        fcTimes.push(dt.toISOString().slice(0, 10));
        const doy = getDayOfYear(dt);
        const dayEt0 = et0Hargreaves(Tmin[lastI], Tmax[lastI], T[lastI], t.lat, doy);
        const dayRain = dIdx === 0 ? rain[lastI] : 0;
        fcTmax.push(+Tmax[lastI].toFixed(1));
        fcTmin.push(+Tmin[lastI].toFixed(1));
        fcRain.push(+dayRain.toFixed(1));
        fcRainProb.push(Math.max(10, Math.min(90, Math.round(rh[lastI] * 0.6))));
        fcWindMax.push(+(wsMax[lastI] * 3.6).toFixed(1));
        fcEt0.push(dayEt0);
        fcCodes.push(deriveNasaWeatherCode(dayRain, rh[lastI], Tmax[lastI], Tmin[lastI]));
        s0.push(curTop); s1.push(curRoot); s2.push(curProf);
        t0.push(+ts[lastI].toFixed(1)); t6.push(+((ts[lastI] * 0.75 + T[lastI] * 0.25)).toFixed(1));
      }
      const fc = {
        cur: { temperature_2m: +T[lastI].toFixed(1), relative_humidity_2m: Math.round(rh[lastI]), wind_speed_10m: +(ws[lastI] * 3.6).toFixed(1), weather_code: fcCodes[0] },
        d: { time: fcTimes, weather_code: fcCodes, temperature_2m_max: fcTmax, temperature_2m_min: fcTmin, precipitation_sum: fcRain, precipitation_probability_max: fcRainProb, wind_speed_10m_max: fcWindMax, et0_fao_evapotranspiration: fcEt0 },
        s0, s1, s2, t0, t6
      };
      return { past, fc };
    } catch (e) {}
  }
  return null;
}

async function load() {
  const t = S.sel; if (!t) return;
  document.querySelector('.main-content').classList.add('loading'); note('');
  const N = +$('range').value || 30;
  const res = await fetchNasaAllData(t, N);
  document.querySelector('.main-content').classList.remove('loading');
  S.past = res ? res.past : null; S.fc = res ? res.fc : null;
  if (!S.past && !S.fc) note('Məlumat yüklənmədi. İnternet bağlantısını yoxlayın.', true);
  render();
}

/* ---------- Göstərmə ---------- */
function lastIdx(a) { for (let i = a.length - 1; i >= 0; i--) if (a[i] != null) return i; return -1; }
function render() {
  const t = S.sel, P = S.past, F = S.fc;
  $('stArea').textContent = t.area ? t.area.toFixed(1) : '—';
  $('stAreaSub').textContent = t.area ? 'Çəkilmiş sərhəd üzrə' : 'Nöqtə seçilib — sahə çəkin';
  let risks = [], rec = 'Məlumat yoxdur.';
  if (P) {
    const i = lastIdx(P.root), w = i >= 0 ? P.root[i] : null;
    if (i >= 0) {
      const prev = P.root[Math.max(0, i - 7)], diff = prev != null ? (w - prev) * 100 : null;
      $('stMoist').textContent = num(w * 100);
      $('stMoistSub').innerHTML = (diff != null ? `<span class="trend ${diff < 0 ? 'down' : 'up'}">${diff < 0 ? '↓' : '↑'} ${Math.abs(diff).toFixed(1)}</span> 7 gün əvvələ görə · ` : '') + fmtD(P.dates[i]) + ' (NASA)';
      const score = Math.round((1 - w) * 100), lvl = w < .25 ? 'Yüksək' : w < .45 ? 'Orta' : 'Aşağı';
      $('stDrought').textContent = lvl; $('stDroughtSub').innerHTML = `<span class="status-dot warning"></span> İndeks ${score}/100`;
      risks.push(['Quraqlıq (kök zonası)', score, lvl]);
      rec = lvl === 'Yüksək' ? 'Torpaq çox quruyub — suvarmanı təcili planlaşdırın.' : lvl === 'Orta' ? 'Rütubət azalır, suvarma ehtiyacını yoxlayın.' : 'Torpaq rütubəti normaldır.';
    }
  }
  if (F) {
    const rain = F.d.precipitation_sum.reduce((x, y) => x + (y || 0), 0), et = F.d.et0_fao_evapotranspiration.reduce((x, y) => x + (y || 0), 0);
    $('stRain').textContent = rain.toFixed(1); $('stRainSub').textContent = `Buxarlanma ≈ ${et.toFixed(1)} mm`;
    const def = Math.round(Math.max(0, 1 - rain / (et || 1)) * 100);
    risks.push(['Su çatışmazlığı (proqnoz)', def, def > 66 ? 'Yüksək' : def > 33 ? 'Orta' : 'Aşağı']);
    const tm = Math.max(...F.d.temperature_2m_max), hs = Math.min(100, Math.max(0, Math.round((tm - 25) * 10)));
    risks.push(['İstilik stressi', hs, hs > 66 ? 'Yüksək' : hs > 33 ? 'Orta' : 'Aşağı']);
    if (rain >= 15) rec += ' Növbəti günlərdə güclü yağış gözlənilir — suvarmanı təxirə salın.';
    const c = F.cur, [cn, ic] = wx(c.weather_code);
    $('wTemp').textContent = num(c.temperature_2m); $('wCond').textContent = cn; $('wIcon').textContent = ic;
    $('wRain').textContent = (F.d.precipitation_probability_max[0] ?? '—') + '%'; $('wWind').textContent = num(c.wind_speed_10m) + ' km/s'; $('wHum').textContent = c.relative_humidity_2m + '%';
  }
  $('riskBox').innerHTML = risks.map(([n, v, l]) => `<div class="risk-item"><div class="risk-label"><span>${n}</span><strong>${v}%</strong></div><div class="progress"><span class="bar ${l === 'Aşağı' ? 'green-bar' : l === 'Orta' ? 'amber' : 'amber'}" style="width:${v}%;${l === 'Yüksək' ? 'background:#C76D58' : ''}"></span></div><small>${l} risk</small></div>`).join('');
  $('recText').textContent = rec;
  let sn = '';
  if (P) { const i = lastIdx(P.root); if (i >= 0) sn += `<h3>NASA POWER · ${fmtD(P.dates[i])} (son mövcud gün)</h3><div><span>Səth nəmliyi (0–5 sm)</span><strong>${num(P.top[i] * 100)}%</strong></div><div><span>Kök zonası (0–100 sm)</span><strong>${num(P.root[i] * 100)}%</strong></div><div><span>Profil nəmliyi</span><strong>${num(P.prof[i] * 100)}%</strong></div><div><span>Yer səthi temperaturu</span><strong>${num(P.ts[i], 1)} °C</strong></div>`; }
  if (F) sn += `<h3 style="margin-top:8px">NASA POWER · bu gün (orta)</h3><div><span>Səth nəmliyi (0–5 sm)</span><strong>${num(F.s0[0] * 100)}%</strong></div><div><span>Kök zonası (0–100 sm)</span><strong>${num(F.s1[0] * 100)}%</strong></div><div><span>Torpaq temp. 0 / 6 sm</span><strong>${num(F.t0[0], 1)} / ${num(F.t6[0], 1)} °C</strong></div>`;
  $('soilNow').innerHTML = sn;
  $('todayLabel').textContent = new Date().getDate() + ' ' + MONTHS[new Date().getMonth()].toUpperCase() + ' ' + new Date().getFullYear() + ' · ' + DAYS[new Date().getDay()].toUpperCase();
  drawPast(); drawForecast();
}
function mk(id, cfg) { if (S.charts[id]) S.charts[id].destroy(); S.charts[id] = new Chart($(id), cfg); }
const base = (extra = {}) => ({ responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { display: true, labels: { boxWidth: 10, font: { size: 10 } } } }, scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 10, font: { size: 10 } } }, y: { grid: { color: '#edf0eb' }, ticks: { font: { size: 10 } } } }, ...extra });
function drawPast() {
  const P = S.past; if (!P) return; const L = P.dates.map(fmtD), pc = a => a.map(v => v == null ? null : +(v * 100).toFixed(1));
  const ln = (label, data, color) => ({ label, data, borderColor: color, backgroundColor: color, tension: .3, borderWidth: 2, pointRadius: 1.5, spanGaps: true });
  let cfg;
  if (S.tab === 'moist') cfg = { type: 'line', data: { labels: L, datasets: [ln('Səth %', pc(P.top), '#78A5C1'), ln('Kök zonası %', pc(P.root), '#4F8B55'), ln('Profil %', pc(P.prof), '#173D2B')] }, options: base() };
  else if (S.tab === 'rain') cfg = { type: 'bar', data: { labels: L, datasets: [{ label: 'Yağıntı (mm/gün)', data: P.rain, backgroundColor: '#78A5C1' }] }, options: base() };
  else cfg = { type: 'line', data: { labels: L, datasets: [ln('Maks °C', P.Tmax, '#C76D58'), ln('Orta °C', P.T, '#D9A441'), ln('Min °C', P.Tmin, '#5884A6')] }, options: base() };
  mk('pastChart', cfg);
}
function drawForecast() {
  const F = S.fc; if (!F) return; const d = F.d, L = d.time.map(fmtD);
  mk('fcChart', { data: { labels: L, datasets: [
    { type: 'bar', label: 'Yağıntı (mm)', data: d.precipitation_sum, backgroundColor: '#78A5C1', yAxisID: 'y' },
    { type: 'line', label: 'Maks °C', data: d.temperature_2m_max, borderColor: '#C76D58', yAxisID: 'y1', tension: .3 },
    { type: 'line', label: 'Min °C', data: d.temperature_2m_min, borderColor: '#5884A6', yAxisID: 'y1', tension: .3 }] },
    options: base({ scales: { x: { grid: { display: false } }, y: { position: 'left', title: { display: true, text: 'mm' }, grid: { color: '#edf0eb' } }, y1: { position: 'right', title: { display: true, text: '°C' }, grid: { display: false } } } }) });
  let h = '<tr><th>Tarix</th><th>Hava</th><th>Temp. min/maks</th><th>Yağıntı</th><th>Külək</th><th>Nəmlik 0–1 sm</th><th>Nəmlik 27–81 sm</th><th>Buxarlanma</th></tr>';
  d.time.forEach((day, i) => { const dt = new Date(day + 'T00:00:00'); h += `<tr><td>${fmtD(day)} · ${DAYS[dt.getDay()]}</td><td>${wx(d.weather_code[i]).join(' ')}</td><td>${num(d.temperature_2m_min[i])}° / ${num(d.temperature_2m_max[i])}°</td><td>${num(d.precipitation_sum[i], 1)} mm (${d.precipitation_probability_max[i] ?? '—'}%)</td><td>${num(d.wind_speed_10m_max[i])} km/s</td><td>${num(F.s0[i] * 100)}%</td><td>${num(F.s2[i] * 100)}%</td><td>${num(d.et0_fao_evapotranspiration[i], 1)} mm</td></tr>`; });
  $('fcTable').innerHTML = h;
}

/* ---------- Hadisələr ---------- */
$('tabs').onclick = e => { const b = e.target.closest('button'); if (!b) return; S.tab = b.dataset.tab; [...$('tabs').children].forEach(x => x.classList.toggle('active', x === b)); drawPast(); };
$('range').onchange = load; $('refreshBtn').onclick = load;
$('menuToggle').onclick = () => $('sidebar').classList.toggle('open');
document.querySelectorAll('.nav-link').forEach(a => a.onclick = () => { document.querySelectorAll('.nav-link').forEach(x => x.classList.remove('active')); a.classList.add('active'); $('sidebar').classList.remove('open'); });

renderList(); setMode('point');
select(S.fields[0] || { name: 'Nümunə nöqtə (Kür–Araz ovalığı)', lat: 40.0, lng: 48.0 });
