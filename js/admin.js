import { dbRef } from './firebase-config.js';
import {
  onValue,
  set,
  get,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

// ─── Constants ───────────────────────────────────────────────────────────────

const FLOORS = ['G', 'L1', 'L2', 'L3'];

// ─── State ───────────────────────────────────────────────────────────────────

const state = {
  SE4: { G: 72, L1: 65, L2: 38, L3: 4 },
  SE5: 95,
  users: 24,
  leaving: 3,
};

const capacity = { G: 80, L1: 80, L2: 80, L3: 5, SE5: 120 };

let selectedFloor = 'G';
let logs = [];

// ─── Capacity display ─────────────────────────────────────────────────────────

function refreshCapUsed(floor) {
  const cap = floor === 'SE5' ? capacity.SE5 : capacity[floor];
  const el = document.getElementById('cu-' + floor);
  if (!el) return;
  const taken = floor === 'SE5' ? state.SE5 : state.SE4[floor];
  const safe = Math.min(taken, cap);
  const pct = Math.round((safe / cap) * 100);
  el.textContent = `${safe}/${cap}`;
  el.style.color = pct < 50 ? 'var(--green)' : pct < 85 ? 'var(--amber)' : 'var(--red)';
}

function syncCapacityUI() {
  FLOORS.forEach(floor => {
    const slider = document.getElementById('cap-' + floor);
    const valEl = document.getElementById('cv-' + floor);
    if (slider) slider.value = capacity[floor];
    if (valEl) valEl.textContent = capacity[floor];
    refreshCapUsed(floor);
  });
  const se5Slider = document.getElementById('cap-SE5');
  const se5Val = document.getElementById('cv-SE5');
  if (se5Slider) se5Slider.value = capacity.SE5;
  if (se5Val) se5Val.textContent = capacity.SE5;
  refreshCapUsed('SE5');
}

// ─── Status display ───────────────────────────────────────────────────────────

function renderStatus() {
  FLOORS.forEach(floor => {
    const el = document.getElementById('st-' + floor);
    if (!el) return;
    const cap = capacity[floor];
    const pct = state.SE4[floor] / cap;
    const open = Math.max(0, cap - state.SE4[floor]);
    el.textContent = `${open} open · ${Math.round(Math.min(100, pct * 100))}% (cap ${cap})`;
    el.className = 'status-val ' + (pct < 0.5 ? 'g' : pct < 0.85 ? 'a' : 'r');
  });

  const se5El = document.getElementById('st-SE5');
  if (se5El) {
    const se5Pct = state.SE5 / capacity.SE5;
    const se5Open = Math.max(0, capacity.SE5 - state.SE5);
    se5El.textContent = `${se5Open} open · ${Math.round(Math.min(100, se5Pct * 100))}% (cap ${capacity.SE5})`;
    se5El.className = 'status-val ' + (se5Pct < 0.5 ? 'g' : se5Pct < 0.85 ? 'a' : 'r');
  }

  const usersEl = document.getElementById('st-users');
  if (usersEl) usersEl.textContent = state.users + ' online';
}

// ─── Toast ───────────────────────────────────────────────────────────────────

function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), 2500);
}

// ─── Activity log ─────────────────────────────────────────────────────────────

function addLog(text) {
  const cleanText = text.replace(/<[^>]*>/g, '');
  logs.unshift(`[${new Date().toLocaleTimeString()}] ${cleanText}`);
  logs = logs.slice(0, 20);
  document.getElementById('log').innerHTML = logs
    .map(line => `<div class="log-row">${line}</div>`)
    .join('');
}

// ─── Firebase ────────────────────────────────────────────────────────────────

function pushState(event, includeCapacity = false) {
  const payload = {
    SE4: state.SE4,
    SE5: state.SE5,
    users: state.users,
    leaving: state.leaving,
    lastEvent: event || null,
  };
  if (includeCapacity) payload.CAP = capacity;
  set(dbRef, payload);
  if (event) addLog(event.text);
}

onValue(dbRef, snapshot => {
  if (!snapshot.exists()) return;
  const data = snapshot.val();
  if (data.SE4) state.SE4 = { ...state.SE4, ...data.SE4 };
  if (data.SE5 !== undefined) state.SE5 = data.SE5;
  if (data.users !== undefined) state.users = data.users;
  if (data.leaving !== undefined) state.leaving = data.leaving;
  if (data.CAP) Object.assign(capacity, data.CAP);
  renderStatus();
  FLOORS.forEach(floor => refreshCapUsed(floor));
  refreshCapUsed('SE5');
});

// ─── Actions ─────────────────────────────────────────────────────────────────

function applyCapacity() {
  FLOORS.forEach(floor => {
    capacity[floor] = parseInt(document.getElementById('cap-' + floor).value);
    state.SE4[floor] = Math.min(state.SE4[floor], capacity[floor] - 1);
  });
  capacity.SE5 = parseInt(document.getElementById('cap-SE5').value);
  state.SE5 = Math.min(state.SE5, capacity.SE5 - 1);

  pushState(
    {
      cls: 'act-a',
      text: `<strong>Admin</strong> — capacities updated (L3: ${capacity.L3} spots)`,
      t: 'just now',
      ts: Date.now(),
    },
    true
  );
  showToast(`Applied! L3 now has ${capacity.L3} total spots 🎯`);
}

function simulateArrival(lot) {
  if (lot === 'SE4') {
    const cap = capacity[selectedFloor];
    if (state.SE4[selectedFloor] >= cap) {
      showToast(`SE4 ${selectedFloor} is FULL!`);
      return;
    }
    state.SE4[selectedFloor] = Math.min(cap, state.SE4[selectedFloor] + 1);
    state.users = Math.min(50, state.users + 1);
    const open = cap - state.SE4[selectedFloor];
    pushState({
      cls: 'act-a',
      text: `<strong>SE4 · ${selectedFloor}</strong> — car arrived · ${open}/${cap} left`,
      t: 'just now',
      ts: Date.now(),
    });
    showToast(`SE4 ${selectedFloor}: ${open} of ${cap} spots left`);
  } else {
    if (state.SE5 >= capacity.SE5) {
      showToast('SE5 is FULL!');
      return;
    }
    state.SE5 = Math.min(capacity.SE5, state.SE5 + 1);
    state.users = Math.min(50, state.users + 1);
    const open = capacity.SE5 - state.SE5;
    pushState({
      cls: 'act-a',
      text: `<strong>SE5</strong> — car arrived · ${open}/${capacity.SE5} left`,
      t: 'just now',
      ts: Date.now(),
    });
    showToast(`SE5: ${open} of ${capacity.SE5} left`);
  }
}

function simulateDeparture(lot) {
  if (lot === 'SE4') {
    if (state.SE4[selectedFloor] <= 0) {
      showToast(`SE4 ${selectedFloor} already empty!`);
      return;
    }
    state.SE4[selectedFloor] = Math.max(0, state.SE4[selectedFloor] - 1);
    state.users = Math.max(0, state.users - 1);
    const open = capacity[selectedFloor] - state.SE4[selectedFloor];
    pushState({
      cls: 'act-g',
      text: `<strong>SE4 · ${selectedFloor}</strong> — spot freed! ${open} open`,
      t: 'just now',
      ts: Date.now(),
    });
    showToast(`SE4 ${selectedFloor}: spot freed · ${open} open`);
  } else {
    if (state.SE5 <= 0) {
      showToast('SE5 already empty!');
      return;
    }
    state.SE5 = Math.max(0, state.SE5 - 1);
    state.users = Math.max(0, state.users - 1);
    const open = capacity.SE5 - state.SE5;
    pushState({
      cls: 'act-g',
      text: `<strong>SE5</strong> — spot freed! ${open} open`,
      t: 'just now',
      ts: Date.now(),
    });
    showToast(`SE5: spot freed · ${open} open`);
  }
}

const SCENARIOS = {
  busy: {
    fill: cap => Math.round(cap * 0.95),
    se5Fill: cap => Math.round(cap * 0.93),
    users: 38, leaving: 5,
    text: 'Peak hour — all lots filling fast',
    cls: 'act-a',
  },
  quiet: {
    fill: cap => Math.round(cap * 0.15),
    se5Fill: cap => Math.round(cap * 0.2),
    users: 7, leaving: 1,
    text: 'Quiet period — plenty of spots',
    cls: 'act-g',
  },
  morning: {
    fill: (cap, floor) => Math.round(cap * ({ G: 0.97, L1: 0.93, L2: 0.65, L3: 0.22 }[floor] || 0.5)),
    se5Fill: cap => Math.round(cap * 0.82),
    users: 34, leaving: 4,
    text: 'Morning rush — G & L1 almost full, try L3',
    cls: 'act-a',
  },
  reset: {
    fill: (cap, floor) => Math.round(cap * ({ G: 0.9, L1: 0.81, L2: 0.47, L3: 0.15 }[floor] || 0.5)),
    se5Fill: cap => Math.round(cap * 0.79),
    users: 24, leaving: 3,
    text: null,
    cls: 'act-g',
  },
};

function loadScenario(type) {
  const scenario = SCENARIOS[type];
  FLOORS.forEach(floor => {
    state.SE4[floor] = scenario.fill(capacity[floor], floor);
  });
  state.SE5 = scenario.se5Fill(capacity.SE5);
  state.users = scenario.users;
  state.leaving = scenario.leaving;

  pushState(
    scenario.text
      ? { cls: scenario.cls, text: `<strong>Scenario</strong> — ${scenario.text}`, t: 'just now', ts: Date.now() }
      : null
  );
  showToast(`Scenario: ${type.toUpperCase()} ✅`);
}

// ─── Event listeners ─────────────────────────────────────────────────────────

document.querySelectorAll('.cap-slider').forEach(slider => {
  slider.addEventListener('input', () => {
    const floor = slider.dataset.floor;
    document.getElementById('cv-' + floor).textContent = slider.value;
    refreshCapUsed(floor);
  });
});

document.getElementById('apply-cap').addEventListener('click', applyCapacity);

document.querySelectorAll('.floor-sel-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    selectedFloor = btn.dataset.floor;
    document.querySelectorAll('.floor-sel-btn').forEach(b => b.classList.remove('sel'));
    btn.classList.add('sel');
  });
});

document.querySelectorAll('[data-action]').forEach(btn => {
  btn.addEventListener('click', () => {
    const { action, lot } = btn.dataset;
    if (action === 'arrive') simulateArrival(lot);
    if (action === 'depart') simulateDeparture(lot);
  });
});

document.querySelectorAll('[data-scenario]').forEach(btn => {
  btn.addEventListener('click', () => loadScenario(btn.dataset.scenario));
});

// ─── Init ────────────────────────────────────────────────────────────────────

get(dbRef).then(snapshot => {
  if (snapshot.exists()) {
    const data = snapshot.val();
    if (data.SE4) state.SE4 = { ...state.SE4, ...data.SE4 };
    if (data.SE5 !== undefined) state.SE5 = data.SE5;
    if (data.users !== undefined) state.users = data.users;
    if (data.CAP) Object.assign(capacity, data.CAP);
  }
  syncCapacityUI();
  renderStatus();
});
