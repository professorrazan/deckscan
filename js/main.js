import { dbRef } from './firebase-config.js';
import {
  onValue,
  set,
  get,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

// ─── Constants ───────────────────────────────────────────────────────────────

const FLOORS = ['G', 'L1', 'L2', 'L3'];
const DEFAULT_FLOOR_CAP = 80;
const DEFAULT_SE5_CAP = 120;

const SE4_OFFSET = { latMin: -0.0006, latMax: 0.0002, lngMin: -0.0018, lngMax: -0.0006 };
const SE5_OFFSET = { latMin: -0.0006, latMax: 0.0002, lngMin: -0.0004, lngMax: 0.0010 };

const DRIFT_MESSAGES = [
  { cls: 'act-a', text: '<strong>SE4 · G</strong> — new arrival detected' },
  { cls: 'act-g', text: '<strong>SE4 · L2</strong> — spot just freed up' },
  { cls: 'act-a', text: '<strong>SE5</strong> — car pulling in now' },
  { cls: 'act-g', text: '<strong>SE4 · L1</strong> — someone just left' },
  { cls: 'act-a', text: '<strong>SE4 · L3</strong> — vehicle detected' },
  { cls: 'act-g', text: '<strong>SE5</strong> — 2 spots opened up' },
];

// ─── State ───────────────────────────────────────────────────────────────────

const state = {
  SE4: { G: 72, L1: 65, L2: 38, L3: 12 },
  SE5: 95,
  users: 24,
  leaving: 3,
  activeFloor: 'L3',
  selectedLot: 'SE4',
  selectedFloor: 'L3',
  selectedDuration: 60,
  session: null,
  floorCaps: null,
};

let activityFeed = [
  { cls: 'act-g', text: '<strong>L3</strong> — spot just freed up', t: 'just now' },
  { cls: 'act-a', text: '<strong>G floor</strong> — 2 leaving in ~5 min', t: '1m ago' },
  { cls: 'act-g', text: '<strong>SE5</strong> — 3 spots opened', t: '3m ago' },
  { cls: 'act-g', text: '<strong>L1</strong> — filling up', t: '5m ago' },
];

// ─── Map state ───────────────────────────────────────────────────────────────

let map = null;
let userMarker = null;
let se4Rect = null;
let se5Rect = null;
let se4HeatLayer = null;
let se5HeatLayer = null;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getFloorCapacity(floor) {
  return (state.floorCaps && state.floorCaps[floor]) || DEFAULT_FLOOR_CAP;
}

function getSE5Capacity() {
  return (state.floorCaps && state.floorCaps.SE5) || DEFAULT_SE5_CAP;
}

function getFloorAvailable(floor) {
  return getFloorCapacity(floor) - state.SE4[floor];
}

function getTotalAvailable() {
  const se4Available = FLOORS.reduce((total, floor) => total + getFloorAvailable(floor), 0);
  return se4Available + (getSE5Capacity() - state.SE5);
}

function getBestFloor() {
  return FLOORS.reduce((best, floor) =>
    state.SE4[best] / getFloorCapacity(best) < state.SE4[floor] / getFloorCapacity(floor)
      ? best
      : floor
  );
}

function getOccupancyBadge(ratio) {
  if (ratio < 0.5)  return ['Open', 'b-open'];
  if (ratio < 0.85) return ['Busy', 'b-busy'];
  return ['Full', 'b-full'];
}

function getOccupancyColor(ratio) {
  if (ratio < 0.5)  return 'var(--green)';
  if (ratio < 0.85) return 'var(--amber)';
  return 'var(--red)';
}

// ─── Seeded RNG (keeps heatmap and trends deterministic) ─────────────────────

function seededRandom(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Heatmap color gradient: green → amber → red ─────────────────────────────

function heatmapColor(value) {
  const t = Math.max(0, Math.min(1, value));
  let r, g, b;
  if (t < 0.3) {
    const p = t / 0.3;
    r = Math.round(20 + p * 160);
    g = Math.round(185 + p * 25);
    b = Math.round(80 - p * 55);
  } else if (t < 0.55) {
    const p = (t - 0.3) / 0.25;
    r = Math.round(180 + p * 75);
    g = Math.round(210 - p * 90);
    b = 25;
  } else if (t < 0.8) {
    const p = (t - 0.55) / 0.25;
    r = 255;
    g = Math.round(120 - p * 90);
    b = 15;
  } else {
    const p = (t - 0.8) / 0.2;
    r = Math.round(245 - p * 45);
    g = 30;
    b = 20;
  }
  return { r, g, b };
}

// ─── IDW Heatmap Canvas Layer ────────────────────────────────────────────────

class HeatLayer extends L.Layer {
  constructor(bounds, getOccupancy, seed) {
    super();
    this._bounds = L.latLngBounds(bounds);
    this._getOccupancy = getOccupancy;
    this._seed = seed;
    this._canvas = document.createElement('canvas');
    this._canvas.style.cssText = 'position:absolute;pointer-events:none';
  }

  onAdd(map) {
    this._map = map;
    map.getPanes().overlayPane.appendChild(this._canvas);
    map.on('zoom viewreset moveend', this._render, this);
    this._render();
  }

  onRemove(map) {
    map.getPanes().overlayPane.removeChild(this._canvas);
    map.off('zoom viewreset moveend', this._render, this);
  }

  _render() {
    const map = this._map;
    const topLeft = map.latLngToLayerPoint(this._bounds.getNorthWest());
    const bottomRight = map.latLngToLayerPoint(this._bounds.getSouthEast());
    const size = bottomRight.subtract(topLeft);
    const canvas = this._canvas;

    canvas.width = Math.max(2, size.x);
    canvas.height = Math.max(2, size.y);
    canvas.style.left = topLeft.x + 'px';
    canvas.style.top = topLeft.y + 'px';

    const W = canvas.width;
    const H = canvas.height;
    const ctx = canvas.getContext('2d');
    const imageData = ctx.createImageData(W, H);
    const pixels = imageData.data;

    const rand = seededRandom(this._seed);
    const occupancy = this._getOccupancy();
    const POINT_COUNT = 14;

    const points = [];
    for (let i = 0; i < POINT_COUNT; i++) {
      points.push({
        px: (0.05 + rand() * 0.9) * W,
        py: (0.05 + rand() * 0.9) * H,
        heat: Math.min(0.98, occupancy * 0.72 + rand() * 0.35),
      });
    }

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let weightSum = 0;
        let valueSum = 0;
        for (const point of points) {
          const dx = x - point.px;
          const dy = y - point.py;
          const dist = Math.sqrt(dx * dx + dy * dy) || 0.5;
          const weight = 1 / Math.pow(dist, 2.5);
          weightSum += weight;
          valueSum += weight * point.heat;
        }
        const color = heatmapColor(valueSum / weightSum);
        const idx = (y * W + x) * 4;
        pixels[idx]     = color.r;
        pixels[idx + 1] = color.g;
        pixels[idx + 2] = color.b;
        pixels[idx + 3] = 190;
      }
    }
    ctx.putImageData(imageData, 0, 0);
  }

  update() {
    if (this._map) this._render();
  }
}

// ─── Map ─────────────────────────────────────────────────────────────────────

function getBoundsFromOffset(lat, lng, offset) {
  return [
    [lat + offset.latMin, lng + offset.lngMin],
    [lat + offset.latMax, lng + offset.lngMax],
  ];
}

function makeMapLabel(html) {
  return L.divIcon({ className: '', html, iconAnchor: [0, 10] });
}

function drawParkingZones(lat, lng) {
  const se4Bounds = getBoundsFromOffset(lat, lng, SE4_OFFSET);
  const se5Bounds = getBoundsFromOffset(lat, lng, SE5_OFFSET);

  se4Rect = L.rectangle(se4Bounds, {
    color: '#22c98a', weight: 2, fillColor: '#22c98a', fillOpacity: 0.1,
  }).addTo(map);
  se5Rect = L.rectangle(se5Bounds, {
    color: '#f5a623', weight: 2, fillColor: '#f5a623', fillOpacity: 0.1,
  }).addTo(map);

  const se4Center = [
    lat + (SE4_OFFSET.latMin + SE4_OFFSET.latMax) / 2,
    lng + (SE4_OFFSET.lngMin + SE4_OFFSET.lngMax) / 2,
  ];
  const se5Center = [
    lat + (SE5_OFFSET.latMin + SE5_OFFSET.latMax) / 2,
    lng + (SE5_OFFSET.lngMin + SE5_OFFSET.lngMax) / 2,
  ];

  L.marker(se4Center, {
    icon: makeMapLabel(
      '<div style="background:#0d3d28;border:1px solid #22c98a;color:#22c98a;font-family:DM Mono,monospace;font-size:11px;font-weight:500;padding:3px 8px;border-radius:6px;white-space:nowrap">SE4 — deck</div>'
    ),
  }).addTo(map);

  L.marker(se5Center, {
    icon: makeMapLabel(
      '<div style="background:#3d2a08;border:1px solid #f5a623;color:#f5a623;font-family:DM Mono,monospace;font-size:11px;font-weight:500;padding:3px 8px;border-radius:6px;white-space:nowrap">SE5 — surface</div>'
    ),
  }).addTo(map);

  se4HeatLayer = new HeatLayer(
    se4Bounds,
    () => FLOORS.reduce((total, floor) => total + state.SE4[floor] / getFloorCapacity(floor), 0) / FLOORS.length,
    42
  );
  se5HeatLayer = new HeatLayer(
    se5Bounds,
    () => state.SE5 / getSE5Capacity(),
    99
  );
  se4HeatLayer.addTo(map);
  se5HeatLayer.addTo(map);
}

function updateZoneColors() {
  if (!se4Rect || !se5Rect) return;
  const se4Ratio = FLOORS.reduce((t, f) => t + state.SE4[f] / getFloorCapacity(f), 0) / FLOORS.length;
  const se5Ratio = state.SE5 / getSE5Capacity();
  const ratioToColor = v => v < 0.5 ? '#22c98a' : v < 0.85 ? '#f5a623' : '#e84040';
  se4Rect.setStyle({ color: ratioToColor(se4Ratio), fillColor: ratioToColor(se4Ratio) });
  se5Rect.setStyle({ color: ratioToColor(se5Ratio), fillColor: ratioToColor(se5Ratio) });
}

function initMap(lat, lng) {
  document.getElementById('gps-splash').style.display = 'none';
  document.getElementById('map-content').style.display = 'block';

  map = L.map('map', { zoomControl: true, attributionControl: false }).setView([lat, lng], 17);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 20 }).addTo(map);

  const userIcon = L.divIcon({
    className: '',
    html: '<div class="user-dot-wrap"><div class="user-ripple"></div><div class="user-dot"></div></div>',
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
  userMarker = L.marker([lat, lng], { icon: userIcon, zIndexOffset: 1000 }).addTo(map);

  drawParkingZones(lat, lng);

  navigator.geolocation.watchPosition(pos => {
    userMarker.setLatLng([pos.coords.latitude, pos.coords.longitude]);
  }, null, { enableHighAccuracy: true, maximumAge: 2000 });

  renderAll();
  updateZoneColors();
}

function startGPS() {
  if (!navigator.geolocation) {
    initMap(-37.9098, 145.1323);
    return;
  }
  navigator.geolocation.getCurrentPosition(
    pos => initMap(pos.coords.latitude, pos.coords.longitude),
    () => initMap(-37.9098, 145.1323),
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

// ─── Render ──────────────────────────────────────────────────────────────────

function renderFloorGrid(elementId) {
  const el = document.getElementById(elementId);
  if (!el) return;
  const best = getBestFloor();
  el.innerHTML = FLOORS.map(floor => {
    const ratio = state.SE4[floor] / getFloorCapacity(floor);
    const available = getFloorAvailable(floor);
    const [label, badgeClass] = getOccupancyBadge(ratio);
    const barColor = getOccupancyColor(ratio);
    return `
      <div class="floor-card${floor === best ? ' best' : ''}">
        <div class="fc-top">
          <span class="fc-name">${floor}</span>
          <span class="fc-badge ${badgeClass}">${label}</span>
        </div>
        <div class="fc-bar-wrap">
          <div class="fc-bar" style="width:${Math.round(ratio * 100)}%;background:${barColor}"></div>
        </div>
        <div class="fc-footer">
          <span>${available} open</span>
          <span>${Math.round(ratio * 100)}% full</span>
        </div>
      </div>`;
  }).join('');
}

function renderFloorPills() {
  const el = document.getElementById('floor-pills');
  if (!el) return;
  el.innerHTML = FLOORS.map(floor =>
    `<button class="floor-pill${floor === state.activeFloor ? ' active' : ''}" data-floor="${floor}">
      ${floor} · ${getFloorAvailable(floor)} open
    </button>`
  ).join('');
}

function renderFloorButtons() {
  const el = document.getElementById('floor-btns');
  if (!el) return;
  el.innerHTML = FLOORS.map(floor =>
    `<button class="floor-btn${floor === state.selectedFloor ? ' sel' : ''}" data-floor="${floor}">
      ${floor}<br><span style="font-size:9px;opacity:.6">${getFloorAvailable(floor)} open</span>
    </button>`
  ).join('');
}

function renderActivityFeed() {
  const el = document.getElementById('activity');
  if (!el) return;
  el.innerHTML = activityFeed.slice(0, 4).map(item =>
    `<div class="act-item">
      <div class="act-dot ${item.cls}"></div>
      <div class="act-text">${item.text}</div>
      <div class="act-time">${item.t}</div>
    </div>`
  ).join('');
}

function renderAll() {
  document.getElementById('s-open').textContent = getTotalAvailable();
  document.getElementById('s-leaving').textContent = state.leaving;
  document.getElementById('s-users').textContent = state.users;

  const best = getBestFloor();
  document.getElementById('best-name').textContent = best;
  document.getElementById('best-free').textContent = `${getFloorAvailable(best)} open spots\nhead there first`;

  renderFloorPills();
  renderFloorGrid('floor-grid');
  renderFloorGrid('floor-grid-2');
  renderFloorButtons();
  renderActivityFeed();
}

function renderTrends() {
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const hours = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
  const rand = seededRandom(42);

  function occupancyAt(dayIndex, hour) {
    if (dayIndex >= 5)               return 0.1  + rand() * 0.2;
    if (hour >= 8  && hour <= 10)   return 0.8  + rand() * 0.15;
    if (hour >= 11 && hour <= 14)   return 0.6  + rand() * 0.2;
    if (hour >= 15 && hour <= 17)   return 0.5  + rand() * 0.15;
    return 0.15 + rand() * 0.15;
  }

  const table = document.getElementById('trend-table');
  table.innerHTML = `
    <thead>
      <tr>
        <th></th>
        ${hours.map(h => `<th>${h}</th>`).join('')}
      </tr>
    </thead>
    <tbody>
      ${days.map((day, dayIndex) => `
        <tr>
          <td>${day}</td>
          ${hours.map(hour => {
            const value = occupancyAt(dayIndex, hour);
            const color = heatmapColor(value);
            return `<td><div class="trend-cell" style="background:rgb(${color.r},${color.g},${color.b});opacity:.85"></div></td>`;
          }).join('')}
        </tr>
      `).join('')}
    </tbody>`;
}

// ─── Toast ───────────────────────────────────────────────────────────────────

function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), 2800);
}

// ─── Firebase ────────────────────────────────────────────────────────────────

function pushToDatabase(event) {
  set(dbRef, {
    SE4: state.SE4,
    SE5: state.SE5,
    users: state.users,
    leaving: state.leaving,
    lastEvent: event || null,
  });
}

get(dbRef).then(snapshot => {
  if (!snapshot.exists()) {
    set(dbRef, { SE4: state.SE4, SE5: state.SE5, users: state.users, leaving: state.leaving });
  }
});

onValue(dbRef, snapshot => {
  if (!snapshot.exists()) return;
  const data = snapshot.val();
  if (data.SE4)              state.SE4 = { ...state.SE4, ...data.SE4 };
  if (data.SE5 !== undefined) state.SE5 = data.SE5;
  if (data.users !== undefined) state.users = data.users;
  if (data.leaving !== undefined) state.leaving = data.leaving;
  if (data.CAP) state.floorCaps = data.CAP;
  if (data.lastEvent && data.lastEvent.ts) {
    const ev = data.lastEvent;
    if (!activityFeed[0] || activityFeed[0].ts !== ev.ts) {
      activityFeed.unshift({ cls: ev.cls, text: ev.text, t: 'just now', ts: ev.ts });
      activityFeed = activityFeed.slice(0, 6);
    }
  }
  renderAll();
  if (se4HeatLayer) se4HeatLayer.update();
  if (se5HeatLayer) se5HeatLayer.update();
  updateZoneColors();
});

// ─── Background drift (leader election keeps only one tab pushing) ────────────

let isLeader = false;
setTimeout(() => { isLeader = true; }, 3000 + Math.random() * 4000);

setInterval(() => {
  FLOORS.forEach(floor => {
    const cap = getFloorCapacity(floor);
    state.SE4[floor] = Math.max(1, Math.min(cap - 1,
      state.SE4[floor] + (Math.random() < 0.5 ? 1 : -1)
    ));
  });

  if (Math.random() < 0.4) {
    const se5Cap = getSE5Capacity();
    state.SE5 = Math.max(5, Math.min(se5Cap - 2,
      state.SE5 + (Math.random() < 0.5 ? 1 : -1)
    ));
  }

  state.leaving = Math.max(1, Math.min(8,
    state.leaving + (Math.random() < 0.3 ? (Math.random() < 0.5 ? 1 : -1) : 0)
  ));
  state.users = Math.max(8, Math.min(45,
    state.users + (Math.random() < 0.2 ? (Math.random() < 0.5 ? 1 : -1) : 0)
  ));

  if (isLeader) {
    const event = Math.random() < 0.4
      ? { ...DRIFT_MESSAGES[Math.floor(Math.random() * DRIFT_MESSAGES.length)], t: 'just now', ts: Date.now() }
      : null;
    set(dbRef, {
      SE4: state.SE4,
      SE5: state.SE5,
      users: state.users,
      leaving: state.leaving,
      lastEvent: event,
      CAP: state.floorCaps || null,
    });
  } else {
    renderAll();
    if (se4HeatLayer) se4HeatLayer.update();
    if (se5HeatLayer) se5HeatLayer.update();
    updateZoneColors();
  }
}, 9000);

// ─── Actions ─────────────────────────────────────────────────────────────────

function showTab(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  document.querySelector(`.tab[data-tab="${name}"]`).classList.add('active');
  if (name === 'map' && map) {
    setTimeout(() => {
      map.invalidateSize();
      if (se4HeatLayer) se4HeatLayer.update();
      if (se5HeatLayer) se5HeatLayer.update();
    }, 80);
  }
}

function selectLot(lot) {
  state.selectedLot = lot;
  document.getElementById('b-SE4').classList.toggle('sel', lot === 'SE4');
  document.getElementById('b-SE5').classList.toggle('sel', lot === 'SE5');
  document.getElementById('floor-section').style.display = lot === 'SE4' ? 'block' : 'none';
}

function selectFloor(floor) {
  state.selectedFloor = floor;
  renderFloorButtons();
}

function switchActiveFloor(floor) {
  state.activeFloor = floor;
  renderAll();
  if (se4HeatLayer) se4HeatLayer.update();
}

function selectDuration(duration, btn) {
  state.selectedDuration = duration;
  document.querySelectorAll('.dur-btn').forEach(b => b.classList.remove('sel'));
  btn.classList.add('sel');
}

function checkIn() {
  const { selectedLot: lot, selectedFloor: floor } = state;
  if (lot === 'SE4') {
    state.SE4[floor] = Math.min(getFloorCapacity(floor), state.SE4[floor] + 1);
  } else {
    state.SE5 = Math.min(getSE5Capacity(), state.SE5 + 1);
  }
  state.users++;
  state.session = { lot, floor, duration: state.selectedDuration };

  pushToDatabase({
    cls: 'act-a',
    text: `<strong>${lot}${lot === 'SE4' ? ' · ' + floor : ''}</strong> — new arrival`,
    t: 'just now',
    ts: Date.now(),
  });

  document.getElementById('parked-info').textContent =
    `${lot} · ${lot === 'SE4' ? floor : 'surface'} · leaving in ${state.selectedDuration} min`;
  document.getElementById('parked-wrap').style.display = 'block';
  document.getElementById('ci-form').style.display = 'none';
  showToast('Checked in! Heatmap updated live 🟡');
}

function checkOut() {
  if (!state.session) return;
  const { lot, floor } = state.session;
  if (lot === 'SE4') {
    state.SE4[floor] = Math.max(0, state.SE4[floor] - 1);
  } else {
    state.SE5 = Math.max(0, state.SE5 - 1);
  }
  state.users = Math.max(0, state.users - 1);
  state.session = null;

  pushToDatabase({
    cls: 'act-g',
    text: `<strong>${lot}${lot === 'SE4' ? ' · ' + floor : ''}</strong> — spot now free!`,
    t: 'just now',
    ts: Date.now(),
  });

  document.getElementById('parked-wrap').style.display = 'none';
  document.getElementById('ci-form').style.display = 'block';
  showToast('Checked out! Spot freed up 🟢');
}

// ─── Event listeners ─────────────────────────────────────────────────────────

document.querySelectorAll('.tab[data-tab]').forEach(btn => {
  btn.addEventListener('click', () => showTab(btn.dataset.tab));
});

document.getElementById('b-SE4').addEventListener('click', () => selectLot('SE4'));
document.getElementById('b-SE5').addEventListener('click', () => selectLot('SE5'));

// Event delegation for dynamically rendered floor pills and buttons
document.getElementById('floor-pills').addEventListener('click', e => {
  const btn = e.target.closest('[data-floor]');
  if (btn) switchActiveFloor(btn.dataset.floor);
});

document.getElementById('floor-btns').addEventListener('click', e => {
  const btn = e.target.closest('[data-floor]');
  if (btn) selectFloor(btn.dataset.floor);
});

document.querySelectorAll('.dur-btn').forEach(btn => {
  btn.addEventListener('click', () => selectDuration(parseInt(btn.dataset.duration), btn));
});

document.querySelector('.cta').addEventListener('click', checkIn);
document.querySelector('.leave-btn').addEventListener('click', checkOut);

// ─── Init ────────────────────────────────────────────────────────────────────

renderTrends();
startGPS();
