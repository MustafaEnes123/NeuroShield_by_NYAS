/* =========================================================
   NeuroShield dashboard: front-end demo logic
   Every value here is simulated in the browser. In production these
   come from Azure Event Hub, the DL anomaly model and the Pinecone RAG step.
   ========================================================= */
(() => {
  'use strict';

  /* ---------- Helpers ---------- */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = (id, cls = 'icon icon--sm') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${id}"/></svg>`;
  const uid = () => 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const pad = (n) => String(n).padStart(2, '0');
  const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const daysAgo = (n) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - n); return d; };
  const joinList = (a) => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);
  const R = (v) => Math.round(v);
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const mqMobile = window.matchMedia('(max-width: 1024px)');

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const fmtTime = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });
  const fmtDay = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
  const fmtShort = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const fmtLong = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const fromKey = (k) => new Date(`${k}T12:00:00`);

  function when(t) {
    const d = new Date(t);
    const k = dayKey(d);
    if (k === dayKey(new Date())) return fmtTime.format(d);
    if (k === dayKey(daysAgo(1))) return `Yesterday ${fmtTime.format(d)}`;
    return `${fmtDay.format(d)}, ${fmtTime.format(d)}`;
  }
  const fmtMinutes = (m) => `${Math.floor(m / 60)} h ${m % 60} min`;

  function download(name, text, type) {
    const blob = new Blob([text], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /* ---------- Domain model ---------- */
  const WEARER = { name: 'Alex Morgan', first: 'Alex' };

  const CATS = [
    {
      id: 'acute', name: 'Acute event', base: 3,
      marker: 'Spike-wave discharges and rising 3 Hz power, strongest at T7 and T8',
      value: (r) => `${R(r * 0.4)} spikes/min`,
      about: 'Patterns that can come before a seizure or another acute neurological event.',
      action: 'If risk passes the threshold and onset is predicted inside the window, the safety gate opens and asks for consent. Stimulation never starts on its own.',
    },
    {
      id: 'parkinsons', name: "Parkinson's", base: 6,
      marker: 'Prolonged beta bursts, 13 to 30 Hz',
      value: (r) => `${R(120 + r * 4)} ms bursts`,
      about: 'Long, synchronized beta bursts that research links to motor symptoms.',
      action: 'Crossing the threshold logs an event for the care team. No stimulation is offered.',
    },
    {
      id: 'alzheimers', name: "Alzheimer's", base: 5,
      marker: 'Background slowing: theta power rising against alpha',
      value: (r) => `θ/α ${(0.6 + r * 0.012).toFixed(2)}`,
      about: 'Gradual slowing of the background rhythm. Meaningful over weeks, not minutes.',
      action: 'Crossing the threshold logs an event for the care team. No stimulation is offered.',
    },
    {
      id: 'depression', name: 'Depression', base: 8,
      marker: 'Frontal alpha asymmetry between AF3 and AF4',
      value: (r) => `FAA ${(-(0.02 + r * 0.006)).toFixed(2)}`,
      about: 'More alpha over the left frontal lobe than the right. A research marker and the main focus of our NYAS entry.',
      action: 'Crossing the threshold logs an event. The doctor decides whether a treatment plan is worth discussing. No stimulation is offered automatically.',
    },
    {
      id: 'stress', name: 'Stress', base: 11,
      marker: 'Beta to alpha power ratio',
      value: (r) => `β/α ${(0.7 + r * 0.02).toFixed(2)}`,
      about: 'Short-term arousal. Spikes during exercise or exams are normal.',
      action: 'Crossing the threshold logs an event and shows up in the daily report. No stimulation is offered.',
    },
  ];
  const CAT = Object.fromEntries(CATS.map((c) => [c.id, c]));
  const LEVEL_LABEL = { clear: 'Clear', watch: 'Watch', alert: 'Alert' };
  const LEVEL_ICON = { clear: 'check', watch: 'eye', alert: 'alert' };
  const KIND_ICON = { alert: 'alert', watch: 'eye', stim: 'zap', ok: 'check', system: 'sliders' };
  const ROLE_NAME = { user: 'Wearer', caregiver: 'Parent or caregiver', doctor: 'Doctor' };
  const PERM_TEXT = { eeg: 'see live EEG', alerts: 'get alerts', approve: 'approve stimulation' };
  const PERM_LABEL = { eeg: 'See live EEG', alerts: 'Get alerts', approve: 'Approve stimulation' };
  const STIM_SECONDS = 15;
  const CONSENT_SECONDS = 60;

  /* ---------- Seed data ---------- */
  // 13 past days of peak and average risk per category (deterministic).
  const TREND = (() => {
    const out = {};
    CATS.forEach((c, ci) => {
      const rnd = mulberry32(1234 + ci * 97);
      out[c.id] = [];
      for (let i = 13; i >= 1; i--) {
        let peak = c.base + 3 + rnd() * 6;
        if (c.id === 'depression') peak = 9 + (13 - i) * 0.65 + (rnd() - 0.5) * 2;
        if (c.id === 'stress' && i === 1) peak = 27;
        if (c.id === 'stress' && i === 3) peak = 19;
        if (c.id === 'stress' && i === 8) peak = 22;
        if (c.id === 'acute' && i === 9) peak = 14;
        out[c.id].push({ date: dayKey(daysAgo(i)), ago: i, peak: R(peak), avg: R(peak * 0.55) });
      }
    });
    return out;
  })();

  const SEEDED_REPORTS = (() => {
    const arr = [];
    for (let i = 1; i <= 6; i++) {
      const rnd = mulberry32(77 + i);
      const cats = {};
      CATS.forEach((c) => {
        const d = TREND[c.id].find((x) => x.ago === i);
        cats[c.id] = { avg: d.avg, max: d.peak };
      });
      arr.push({ date: dayKey(daysAgo(i)), wearMin: R(560 + rnd() * 180), signal: R(88 + rnd() * 9), interventions: 0, cats });
    }
    return arr;
  })();

  function seedEvents() {
    const now = Date.now(), H = 3600e3, D = 24 * H;
    const y = daysAgo(1); y.setHours(21, 40, 0, 0);
    const mk = (o) => ({ id: uid(), status: null, cat: null, risk: null, ...o });
    return [
      mk({ t: now - 0.5 * H, type: 'system', kind: 'system', title: 'Electrode check passed', detail: 'All four contacts under 20 kΩ after the headset was put on.' }),
      mk({ t: now - 1.2 * H, type: 'info', kind: 'ok', title: "Yesterday's daily report is ready", detail: 'Stress passed the threshold once in the evening. Nothing needed action.' }),
      mk({ t: y.getTime(), type: 'review', kind: 'alert', cat: 'stress', status: 'reviewed', risk: 27, title: 'Stress above threshold for 6 min', detail: 'Beta/alpha ratio peaked at 1.24. Logged, no stimulation offered. Reviewed by Dr. Sarah Chen.' }),
      mk({ t: now - 2 * D - 3 * H, type: 'review', kind: 'watch', cat: 'depression', status: 'open', risk: 17, title: 'Depression markers drifting up', detail: 'Frontal alpha asymmetry has moved toward the watch level over five days. Worth raising at the next check-in.' }),
      mk({ t: now - 9 * D, type: 'review', kind: 'watch', cat: 'acute', status: 'reviewed', risk: 14, title: 'Acute pattern faded before the gate', detail: 'Risk reached 14% and returned to baseline in 3 minutes. No consent request was needed.' }),
    ];
  }

  function seedStore() {
    return {
      v: 1,
      settings: { thRisk: 25, thOnset: 5, idleMode: 'report' },
      members: [
        { id: 'm1', name: 'Dr. Sarah Chen', email: 'sarah.chen@clinic.example', role: 'doctor', relation: 'Neurologist', status: 'active', perms: { eeg: true, alerts: true, approve: true } },
        { id: 'm2', name: 'Leyla Morgan', email: 'leyla.morgan@example.com', role: 'caregiver', relation: 'Mother', status: 'active', perms: { eeg: false, alerts: true, approve: true } },
      ],
      events: seedEvents(),
      customReports: [],
    };
  }

  /* ---------- Persistence ---------- */
  const STORE_KEY = 'neuroshield-demo-v1';
  let store;
  try { store = JSON.parse(localStorage.getItem(STORE_KEY)); } catch { store = null; }
  if (!store || store.v !== 1) store = seedStore();
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch { /* storage unavailable: demo still works in memory */ }
  }
  save();

  /* ---------- Runtime state ---------- */
  const rt = {
    role: 'user',
    risk: {}, target: {}, history: {}, sum: {}, max: {}, prevLevel: {}, lastAlertAt: {},
    onset: null, scenario: 'baseline', scenarioT: 0,
    phase: 'monitor', consentLeft: CONSENT_SECONDS, stimLeft: 0, gateCooldown: 0, gateEventId: null,
    paused: false, timebase: 5, gain: 1, channels: { AF3: true, AF4: true, T7: true, T8: true },
    connected: true, battery: 82, signal: -58, sessionStart: Date.now(), lastSync: Date.now(),
    impedance: { AF3: 11, AF4: 13, T7: 16, T8: 14 },
    n: 0, interventionsToday: 0,
    alertFilter: 'all', trendCat: 'stress', selectedReport: null, view: 'overview', heroTitle: '',
  };
  CATS.forEach((c) => {
    rt.risk[c.id] = c.base;
    rt.target[c.id] = c.base;
    rt.history[c.id] = Array.from({ length: 60 }, () => c.base + (Math.random() - 0.5) * 2);
    rt.sum[c.id] = 0;
    rt.max[c.id] = 0;
    rt.prevLevel[c.id] = 'clear';
  });

  const th = () => store.settings.thRisk;
  const thOnset = () => store.settings.thOnset;
  const level = (r) => (r >= th() ? 'alert' : r >= th() * 0.6 ? 'watch' : 'clear');
  const chip = (lv) => `<span class="chip chip--${lv}">${icon(LEVEL_ICON[lv])}${LEVEL_LABEL[lv]}</span>`;
  const dotIcon = (k) => `<span class="dot-icon" data-kind="${k}">${icon(KIND_ICON[k] || 'bell')}</span>`;

  /* ---------- Roles & permissions ---------- */
  function actingMember() {
    if (rt.role === 'user') return null;
    return store.members.find((m) => m.role === rt.role && m.status === 'active') || null;
  }
  function actorName() {
    if (rt.role === 'user') return WEARER.first;
    const m = actingMember();
    return m ? m.name : rt.role === 'doctor' ? 'A doctor' : 'A parent';
  }
  function can(perm) {
    if (rt.role === 'user') return perm !== 'tune';
    const m = actingMember();
    if (!m) return false;
    if (perm === 'tune') return m.role === 'doctor';
    if (perm === 'manage') return false;
    return !!m.perms[perm];
  }
  function alertRecipients() {
    const names = store.members.filter((m) => m.status === 'active' && m.perms.alerts).map((m) => m.name);
    return names.length ? joinList(names) : 'nobody yet (no one on the care team gets alerts)';
  }
  function approverList() {
    return joinList([`${WEARER.first} (wearer)`, ...store.members.filter((m) => m.status === 'active' && m.perms.approve).map((m) => m.name)]);
  }

  /* ---------- Announcements & toasts ---------- */
  const srLive = document.createElement('p');
  srLive.className = 'visually-hidden';
  srLive.setAttribute('role', 'status');
  document.body.append(srLive);
  function announce(msg) { srLive.textContent = ''; setTimeout(() => { srLive.textContent = msg; }, 50); }

  function toast(msg, kind = 'info') {
    const box = $('#toasts');
    const el = document.createElement('div');
    el.className = 'toast';
    el.dataset.kind = kind;
    const ic = kind === 'alert' ? 'alert' : kind === 'ok' ? 'check-circle' : 'bell';
    el.innerHTML = `${icon(ic, 'icon')}<p>${esc(msg)}</p><button class="btn btn--icon btn--paper" type="button" aria-label="Dismiss notification">${icon('x')}</button>`;
    const remove = () => el.remove();
    el.querySelector('button').addEventListener('click', remove);
    box.append(el);
    while (box.children.length > 4) box.firstElementChild.remove();
    setTimeout(remove, kind === 'alert' ? 8000 : 5000);
  }

  /* ---------- Events ---------- */
  function addEvent(e) {
    const ev = { id: uid(), t: Date.now(), status: null, cat: null, risk: null, ...e };
    store.events.unshift(ev);
    if (store.events.length > 200) store.events.length = 200;
    save();
    renderEvents();
    renderRecent();
    updateCounts();
    return ev;
  }

  function updateCounts() {
    const n = store.events.filter((e) => e.status === 'open').length;
    [$('#bell-count'), $('#nav-alert-count')].forEach((el) => { el.hidden = n === 0; el.textContent = n; });
    $('#bell-btn').setAttribute('aria-label', n ? `Alerts, ${n} need review` : 'Alerts, none need review');
  }

  function renderRecent() {
    const items = store.events.slice(0, 5);
    $('#recent-list').innerHTML = items.length
      ? items.map((e) => `<li>${dotIcon(e.kind)}<span class="recent__title">${esc(e.title)}</span><time class="recent__time" datetime="${new Date(e.t).toISOString()}">${when(e.t)}</time></li>`).join('')
      : '<li class="empty-line">No events yet. Run a scenario to see one.</li>';
  }

  function renderEvents() {
    const f = rt.alertFilter;
    const list = store.events.filter((e) => f === 'all'
      || (f === 'review' && e.status === 'open')
      || (f === 'intervention' && e.type === 'intervention')
      || (f === 'system' && e.type === 'system'));
    $('#event-list').innerHTML = list.map((e) => {
      const c = CAT[e.cat];
      const status = e.status === 'open'
        ? `<span class="chip chip--alert">${icon('alert')}Needs review</span>`
        : e.status === 'reviewed' ? `<span class="chip chip--clear">${icon('check')}Reviewed</span>` : '';
      return `<li class="event" data-status="${e.status || ''}">
        ${dotIcon(e.kind)}
        <div>
          <p class="event__title">${esc(e.title)}</p>
          <p class="event__detail">${esc(e.detail)}</p>
          <div class="event__meta">${c ? `<span class="chip chip--muted">${c.name}</span>` : ''}${e.risk != null ? `<span class="chip chip--muted mono">${e.risk}%</span>` : ''}${status}</div>
        </div>
        <div class="event__side">
          <time class="event__time" datetime="${new Date(e.t).toISOString()}">${when(e.t)}</time>
          ${e.status === 'open' ? `<button class="btn btn--sm btn--paper" type="button" data-review="${e.id}">${icon('check')}Mark reviewed</button>` : ''}
        </div>
      </li>`;
    }).join('');
    $('#events-empty').hidden = list.length > 0;
  }

  /* ---------- Category cards ---------- */
  function buildCats() {
    $('#cat-grid').innerHTML = CATS.map((c) => `
      <button class="cat" type="button" data-cat="${c.id}" aria-haspopup="dialog">
        <span class="cat__top"><span class="cat__name">${c.name}</span><span data-f="chip"></span></span>
        <span class="cat__value" data-f="value">0%</span>
        <svg class="spark" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true"><line data-f="gate" x1="0" x2="100"/><polyline data-f="line"/></svg>
        <span class="cat__marker" data-f="marker"></span>
        <span class="cat__foot"><span data-f="foot"></span><span class="link" aria-hidden="true">Details</span></span>
      </button>`).join('');
  }

  function sparkPoints(hist) {
    const scale = Math.max(50, th() * 2);
    const y = (v) => (26 - (Math.min(v, scale) / scale) * 24).toFixed(2);
    return { points: hist.map((v, i) => `${((i / (hist.length - 1)) * 100).toFixed(2)},${y(v)}`).join(' '), gate: y(th()) };
  }

  function updateCats() {
    CATS.forEach((c) => {
      const el = $(`.cat[data-cat="${c.id}"]`);
      const r = rt.risk[c.id];
      const lv = level(r);
      if (el.dataset.level !== lv) {
        el.dataset.level = lv;
        $('[data-f="chip"]', el).innerHTML = chip(lv);
      }
      $('[data-f="value"]', el).textContent = `${R(r)}%`;
      $('[data-f="marker"]', el).textContent = c.value(r);
      $('[data-f="foot"]', el).textContent = c.id === 'acute'
        ? (rt.onset != null ? `Onset in about ${Math.ceil(rt.onset)} min` : 'No onset predicted')
        : `Threshold ${th()}%`;
      const sp = sparkPoints(rt.history[c.id]);
      $('[data-f="line"]', el).setAttribute('points', sp.points);
      const g = $('[data-f="gate"]', el);
      g.setAttribute('y1', sp.gate); g.setAttribute('y2', sp.gate);
    });
    $('#cat-note').textContent = `Alert at ${th()}%, watch from ${R(th() * 0.6)}%. Select a category for details.`;
  }

  function openCat(id) {
    const c = CAT[id];
    const r = rt.risk[id];
    const sp = sparkPoints(rt.history[id]);
    const peak = R(Math.max(...rt.history[id]));
    $('#cat-d-title').textContent = c.name;
    $('#cat-d-body').innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">${chip(level(r))}<span class="cat__value">${R(r)}%</span><span class="note">Threshold ${th()}%</span></div>
      <svg class="spark" style="height:72px" viewBox="0 0 100 28" preserveAspectRatio="none" role="img" aria-label="Risk over the last 60 seconds, peak ${peak}%"><line x1="0" x2="100" y1="${sp.gate}" y2="${sp.gate}"/><polyline points="${sp.points}"/></svg>
      <p>${c.about}</p>
      <ul class="kv">
        <li><span>EEG marker</span><strong>${c.marker}</strong></li>
        <li><span>Right now</span><strong class="mono">${c.value(r)}</strong></li>
        <li><span>Peak, last 60 s</span><strong class="mono">${peak}%</strong></li>
      </ul>
      <p class="note note--role">${c.action}</p>
      <div class="btn-row"><a class="btn btn--sm btn--paper" href="#live" data-close>${icon('activity')}Open live EEG</a><a class="btn btn--sm btn--paper" href="#alerts" data-close>${icon('bell')}See alerts</a></div>`;
    showDialog($('#cat-dialog'));
  }

  /* ---------- Hero ---------- */
  function updateHero() {
    const hero = $('#hero');
    let top = CATS[0];
    CATS.forEach((c) => { if (rt.risk[c.id] > rt.risk[top.id]) top = c; });
    const alerts = CATS.filter((c) => level(rt.risk[c.id]) === 'alert');
    const watches = CATS.filter((c) => level(rt.risk[c.id]) === 'watch');
    let lv, ic, title, text, action = null;

    if (!rt.connected) {
      lv = 'watch'; ic = 'wifi-off'; title = 'Headset reconnecting';
      text = 'Monitoring is on hold until the headset is back. This usually takes a few seconds.';
    } else if (rt.phase === 'stim') {
      lv = 'stim'; ic = 'zap'; title = 'Stimulation in progress';
      text = `Session ends in ${rt.stimLeft} s. EEG sensors are paused because the current drowns out the signal.`;
    } else if (rt.phase === 'consent') {
      lv = 'alert'; ic = 'alert'; title = 'Acute event predicted';
      text = `Risk ${R(rt.risk.acute)}% with onset in about ${Math.ceil(rt.onset)} min. ${can('approve') ? 'Approve or decline stimulation.' : `Waiting for ${WEARER.first} or an approved caregiver.`}`;
      action = { label: can('approve') ? 'Review and respond' : 'View details', act: 'consent' };
    } else if (alerts.length) {
      lv = 'alert'; ic = 'alert';
      title = alerts.length === 1 ? `${alerts[0].name} anomaly detected` : `${alerts.length} anomalies detected`;
      text = alerts.length === 1 && alerts[0].id === 'acute'
        ? `Acute risk is ${R(rt.risk.acute)}%. The safety gate opens if onset is predicted within ${thOnset()} min.`
        : `${joinList(alerts.map((c) => `${c.name} ${R(rt.risk[c.id])}%`))}, above your ${th()}% threshold. Logged for the care team.`;
      action = { label: 'Open alerts', act: 'alerts' };
    } else if (watches.length) {
      lv = 'watch'; ic = 'eye'; title = `Keep an eye on ${joinList(watches.map((c) => c.name))}`;
      text = `${joinList(watches.map((c) => `${c.name} ${R(rt.risk[c.id])}%`))}, close to your ${th()}% threshold. No action needed yet.`;
    } else {
      lv = 'clear'; ic = 'check-circle'; title = 'No anomaly detected';
      text = `All five categories are under your ${th()}% threshold. Monitoring continues in the background.`;
    }

    hero.dataset.level = lv;
    $('#hero-icon use').setAttribute('href', `#i-${ic}`);
    if (rt.heroTitle !== title) { rt.heroTitle = title; $('#hero-title').textContent = title; announce(title); }
    $('#hero-text').textContent = text;
    const btn = $('#hero-action');
    btn.hidden = !action;
    if (action) { btn.textContent = action.label; btn.dataset.act = action.act; }

    const topR = R(rt.risk[top.id]);
    $('#hero-risk').textContent = `${topR}%`;
    $('#hero-risk-cat').textContent = top.name;
    const m = $('#hero-meter');
    m.style.width = `${clamp(topR, 0, 100)}%`;
    m.dataset.level = level(topR);
    $('#hero-gate-mark').style.left = `${th()}%`;
    $('#hero-onset').textContent = rt.onset != null ? `~${Math.ceil(rt.onset)} min` : 'None';
    $('#hero-gate').textContent = rt.phase === 'consent' ? 'Open, waiting for consent'
      : rt.phase === 'stim' ? 'Stimulating'
      : rt.gateCooldown > 0 ? 'Closed, cooling down'
      : `Closed. Opens above ${th()}% with onset under ${thOnset()} min`;
  }

  /* ---------- Consent flow ---------- */
  function renderEvidence() {
    const rows = [
      ['Risk level', `${R(rt.risk.acute)}%`],
      ['Time to onset', rt.onset != null ? `~${Math.ceil(rt.onset)} min` : 'None'],
      ['Treatment protocol', 'tDCS, 1 mA, 20 min'],
      ['tDCS success rate', '72%'],
      ['Intervention risk', 'Low, mild tingling'],
      ['Literature matches', '14 papers'],
    ];
    $('#cd-evidence').innerHTML = rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
  }

  function updateConsentUI() {
    const open = rt.phase === 'consent';
    $('#consent-banner').hidden = !open;
    const allowed = can('approve');
    $('#cd-approve').disabled = !allowed;
    $('#cd-deny').disabled = !allowed;
    const note = $('#cd-role-note');
    note.hidden = allowed;
    note.textContent = allowed ? '' : `You can't decide for ${WEARER.first}. ${WEARER.first} can allow it in Care team.`;
    if (!open) return;
    $('#consent-banner-text').textContent = allowed
      ? `${rt.consentLeft} s left to decide. With no answer, stimulation is held and an emergency alert goes out.`
      : `Waiting for ${WEARER.first} or an approved caregiver. ${rt.consentLeft} s left.`;
    $('#consent-banner-btn').textContent = allowed ? 'Review and respond' : 'View details';
    $('#cd-bar').style.width = `${(rt.consentLeft / CONSENT_SECONDS) * 100}%`;
    $('#cd-time').textContent = `${rt.consentLeft} s left`;
    renderEvidence();
  }

  function showConsentDialog() {
    if (rt.phase !== 'consent') return;
    renderEvidence();
    updateConsentUI();
    showDialog($('#consent-dialog'));
  }

  function openConsent() {
    rt.phase = 'consent';
    rt.consentLeft = CONSENT_SECONDS;
    const ev = addEvent({
      type: 'intervention', kind: 'alert', cat: 'acute', status: 'open', risk: R(rt.risk.acute),
      title: 'Safety gate opened, consent requested',
      detail: `Risk ${R(rt.risk.acute)}% with onset predicted in about ${Math.ceil(rt.onset)} min. Push alert sent to ${approverList()}.`,
    });
    rt.gateEventId = ev.id;
    toast('Safety gate open. Consent needed for stimulation.', 'alert');
    updateConsentUI();
    if (can('approve')) showConsentDialog();
  }

  function closeConsent(outcome) {
    if (rt.phase !== 'consent') return;
    const dlg = $('#consent-dialog');
    if (dlg.open) dlg.close();
    const gate = store.events.find((e) => e.id === rt.gateEventId);
    if (gate) gate.status = 'reviewed';
    const who = actorName();
    if (outcome === 'approve') {
      rt.phase = 'stim';
      rt.stimLeft = STIM_SECONDS;
      rt.interventionsToday++;
      addEvent({ type: 'intervention', kind: 'stim', cat: 'acute', title: `Stimulation approved by ${who}`, detail: `Signed command sent to the headset over TLS 1.3 and verified by its security module. Demo session length ${STIM_SECONDS} s. EEG sensors pause while current flows.` });
      toast('Stimulation approved. EEG is paused until the session ends.', 'info');
    } else if (outcome === 'decline' || outcome === 'timeout') {
      rt.phase = 'monitor';
      rt.scenario = 'aftermath';
      rt.scenarioT = 0;
      rt.gateCooldown = 60;
      if (outcome === 'decline') {
        addEvent({ type: 'intervention', kind: 'alert', cat: 'acute', status: 'open', risk: R(rt.risk.acute), title: `Stimulation declined by ${who}`, detail: `No current was sent. The event was encrypted, logged and shared with ${alertRecipients()}.` });
        toast('Declined. No stimulation sent. The care team was told.', 'info');
      } else {
        addEvent({ type: 'intervention', kind: 'alert', cat: 'acute', status: 'open', risk: R(rt.risk.acute), title: `No response in ${CONSENT_SECONDS} s, stimulation held`, detail: `Nothing was sent to the headset. Emergency alert sent to ${alertRecipients()} and the emergency contact network.` });
        toast('No response. Stimulation held and emergency alert sent.', 'alert');
      }
    } else {
      rt.phase = 'monitor';
      rt.gateCooldown = 10;
      addEvent({ type: 'system', kind: 'system', cat: 'acute', title: 'Scenario cleared before a decision', detail: 'Demo control. No stimulation was sent.' });
    }
    save();
    renderEvents();
    updateCounts();
    updateUI();
  }

  function finishStim() {
    rt.phase = 'monitor';
    rt.scenario = 'baseline';
    rt.scenarioT = 0;
    rt.onset = null;
    rt.gateCooldown = 30;
    rt.risk.acute = 9;
    addEvent({ type: 'intervention', kind: 'ok', cat: 'acute', risk: 9, title: 'Stimulation finished', detail: 'Sensors back online. Post-session check: acute risk 9%, back under threshold.' });
    toast('Stimulation finished. Acute risk is back under threshold.', 'ok');
  }

  /* ---------- Scenarios ---------- */
  const SCENARIO_MSG = {
    acute: 'Acute event scenario running. Watch the Acute card and the safety gate.',
    depression: 'Depression drift scenario running. Frontal alpha asymmetry will rise.',
    stress: 'Stress spike scenario running for about 40 seconds.',
  };
  function runScenario(s) {
    if (s === 'baseline') {
      if (rt.phase === 'consent') closeConsent('cleared');
      rt.scenario = 'baseline';
      rt.scenarioT = 0;
      rt.onset = null;
      toast('Back to baseline. Values settle over a few seconds.', 'info');
      return;
    }
    rt.scenario = s;
    rt.scenarioT = 0;
    toast(SCENARIO_MSG[s], 'info');
  }

  function onCategoryAlert(c) {
    const r = R(rt.risk[c.id]);
    if (c.id === 'acute') {
      addEvent({ type: 'review', kind: 'alert', cat: 'acute', status: 'open', risk: r, title: 'Acute pattern above threshold', detail: `Risk reached ${r}%. The safety gate opens only if onset is predicted within ${thOnset()} min.` });
      toast(`Acute pattern at ${r}%. Watching onset closely.`, 'alert');
    } else {
      addEvent({ type: 'review', kind: 'alert', cat: c.id, status: 'open', risk: r, title: `${c.name} above threshold`, detail: `${c.name} reached ${r}% (${c.value(rt.risk[c.id])}). Logged and shared with ${alertRecipients()}. No stimulation is offered for this category.` });
      toast(`${c.name} passed your threshold. Logged for review.`, 'alert');
    }
  }

  /* ---------- Simulation tick (1 Hz) ---------- */
  function tick() {
    rt.scenarioT++;
    const T = rt.scenarioT;
    CATS.forEach((c) => { rt.target[c.id] = c.base; });

    switch (rt.scenario) {
      case 'acute':
        rt.target.acute = Math.min(90, 3 + T * 4.2);
        if (rt.phase !== 'stim') rt.onset = rt.risk.acute >= 12 ? Math.max(1, 14 - T * 0.5) : null;
        break;
      case 'depression':
        rt.target.depression = Math.min(38, 8 + T * 1.6);
        rt.target.alzheimers = 7;
        rt.onset = null;
        break;
      case 'stress':
        if (T <= 40) { rt.target.stress = 48; rt.target.depression = 10; } else { rt.scenario = 'baseline'; toast('Stress spike over. Back to baseline.', 'ok'); }
        rt.onset = null;
        break;
      case 'aftermath':
        rt.onset = null;
        if (T > 20) rt.scenario = 'baseline';
        break;
      default:
        rt.onset = null;
    }

    const monitoring = rt.connected && rt.phase !== 'stim';
    if (monitoring) {
      CATS.forEach((c) => {
        const k = c.id === 'acute' && rt.scenario === 'acute' ? 0.4 : 0.25;
        rt.risk[c.id] = clamp(rt.risk[c.id] + (rt.target[c.id] - rt.risk[c.id]) * k + (Math.random() - 0.5) * 1.6, 0.5, 99);
      });
    }
    CATS.forEach((c) => {
      const h = rt.history[c.id];
      h.push(rt.risk[c.id]); h.shift();
      rt.sum[c.id] += rt.risk[c.id];
      rt.max[c.id] = Math.max(rt.max[c.id], rt.risk[c.id]);
    });
    rt.n++;

    if (monitoring) {
      CATS.forEach((c) => {
        const lv = level(rt.risk[c.id]);
        if (lv === 'alert' && rt.prevLevel[c.id] !== 'alert' && Date.now() - (rt.lastAlertAt[c.id] || 0) > 60000) {
          rt.lastAlertAt[c.id] = Date.now();
          onCategoryAlert(c);
        }
        rt.prevLevel[c.id] = lv;
      });
      if (rt.phase === 'monitor' && rt.gateCooldown <= 0 && rt.onset != null && rt.risk.acute >= th() && rt.onset <= thOnset()) openConsent();
    }
    if (rt.gateCooldown > 0) rt.gateCooldown--;

    if (rt.phase === 'consent') { rt.consentLeft--; if (rt.consentLeft <= 0) closeConsent('timeout'); }
    if (rt.phase === 'stim') { rt.stimLeft--; if (rt.stimLeft <= 0) finishStim(); }

    if (rt.n % 45 === 0) rt.battery = Math.max(5, rt.battery - 1);
    if (rt.connected) {
      rt.signal = clamp(rt.signal + Math.round((Math.random() - 0.5) * 3), -72, -48);
      if (rt.n % 30 === 0) rt.lastSync = Date.now();
    }
    computeAmps();
    updateUI();
  }

  function updateUI() {
    updateHero();
    updateCats();
    updateDevice();
    updateBadge();
    updateConsentUI();
    updateOverlays();
    updateMarkers();
    if (rt.view === 'live') { updateReadouts(); updateBands(); }
    if (rt.view === 'reports' && rt.n % 5 === 0) renderTrend();
  }

  /* ---------- EEG synthesis & drawing ---------- */
  const CH = ['AF3', 'AF4', 'T7', 'T8'];
  const CH_COLOR = { AF3: '#1C293C', AF4: '#432DD7', T7: '#15803D', T8: '#B45309' }; // ≥3:1 on surface
  const FS = 128;
  const BUF = FS * 10;
  const buf = Object.fromEntries(CH.map((c) => [c, new Float32Array(BUF)]));
  const amps = Object.fromEntries(CH.map((c) => [c, {}]));
  const phase = Object.fromEntries(CH.map((c) => [c, { d: Math.random() * 6, t: Math.random() * 6, a: Math.random() * 6, b: Math.random() * 6, g: Math.random() * 6, m: Math.random() * 6, s: Math.random(), af: 9.6 + Math.random() * 0.8 }]));
  const pink = Object.fromEntries(CH.map((c) => [c, 0]));
  let writeIdx = 0, sampleCount = 0, dirty = true;
  const TAU = Math.PI * 2;

  function computeAmps() {
    const r = rt.risk;
    CH.forEach((ch) => {
      const frontal = ch.startsWith('AF');
      const a = amps[ch];
      a.delta = frontal ? 9 : 8;
      a.theta = 5 + r.alzheimers * 0.12;
      a.alpha = Math.max(2, 12 - r.stress * 0.07 + (ch === 'AF3' ? r.depression * 0.16 : 0) + (frontal ? 0 : 2));
      a.beta = 3.5 + r.stress * 0.16 + r.parkinsons * 0.08;
      a.gamma = 1.4;
      a.noise = 2.5;
      a.spike = Math.max(0, r.acute - 18) * (frontal ? 0.35 : 0.6);
    });
  }

  function sampleAt(ch, t) {
    const a = amps[ch], p = phase[ch];
    const mod = 0.75 + 0.25 * Math.sin(TAU * 0.25 * t + p.m);
    let v = a.delta * Math.sin(TAU * 1.8 * t + p.d)
      + a.theta * Math.sin(TAU * 6.2 * t + p.t)
      + a.alpha * mod * Math.sin(TAU * p.af * t + p.a)
      + a.beta * Math.sin(TAU * 21 * t + p.b)
      + a.gamma * Math.sin(TAU * 40 * t + p.g);
    pink[ch] = pink[ch] * 0.85 + (Math.random() * 2 - 1) * a.noise * 0.55;
    v += pink[ch] + (Math.random() * 2 - 1) * a.noise * 0.3;
    if (a.spike > 0) {
      const ph = (t * 3 + p.s) % 1;
      v += a.spike * (-1.6 * Math.exp(-(((ph - 0.12) / 0.035) ** 2)) + 0.7 * Math.sin(TAU * (ph - 0.25)));
    }
    return v;
  }

  function pushSample() {
    const t = sampleCount / FS;
    CH.forEach((ch) => {
      let v;
      if (!rt.connected) v = (Math.random() - 0.5) * 0.6;
      else if (rt.phase === 'stim') v = clamp(Math.sign(Math.sin(TAU * 31 * t + phase[ch].a)) * 85 + (Math.random() - 0.5) * 60, -140, 140);
      else v = sampleAt(ch, t);
      buf[ch][writeIdx] = v;
    });
    writeIdx = (writeIdx + 1) % BUF;
    sampleCount++;
    dirty = true;
  }

  const canvases = {
    main: { el: $('#eeg-main'), view: 'live', opts: () => ({ seconds: rt.timebase, gain: rt.gain, channels: rt.channels, big: true }) },
    mini: { el: $('#eeg-mini'), view: 'overview', opts: () => ({ seconds: 5, gain: 1, channels: { AF3: true, AF4: true, T7: true, T8: true }, big: false }) },
  };

  function drawEEG(canvas, o) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const vis = CH.filter((c) => o.channels[c]);
    const font = '"JetBrains Mono", ui-monospace, monospace';
    if (!vis.length) {
      ctx.fillStyle = '#556072';
      ctx.font = `600 13px ${font}`;
      ctx.textAlign = 'center';
      ctx.fillText('Select at least one channel', w / 2, h / 2);
      ctx.textAlign = 'start';
      return;
    }
    const labelW = o.big ? 52 : 40;
    const plotW = w - labelW - 6;
    const laneH = h / vis.length;

    ctx.strokeStyle = '#D9DCD3';
    ctx.lineWidth = 1;
    for (let s = 0; s <= o.seconds; s++) {
      const x = Math.round(labelW + plotW * (s / o.seconds)) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    if (o.big) {
      ctx.fillStyle = '#556072';
      ctx.font = `500 11px ${font}`;
      for (let s = 0; s < o.seconds; s++) ctx.fillText(`-${o.seconds - s}s`, labelW + plotW * (s / o.seconds) + 4, h - 6);
    }

    const n = o.seconds * FS;
    const scale = (laneH * 0.45) / (60 / o.gain);
    vis.forEach((ch, i) => {
      const top = laneH * i;
      const y0 = top + laneH / 2;
      if (i > 0) {
        ctx.strokeStyle = '#1C293C'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, Math.round(top) + 0.5); ctx.lineTo(w, Math.round(top) + 0.5); ctx.stroke();
      }
      ctx.setLineDash([3, 4]);
      ctx.strokeStyle = '#C9CCC2';
      ctx.beginPath(); ctx.moveTo(labelW, y0); ctx.lineTo(w, y0); ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = CH_COLOR[ch];
      ctx.font = `700 ${o.big ? 13 : 11}px ${font}`;
      ctx.fillText(ch, 10, y0 + 4);

      ctx.save();
      ctx.beginPath(); ctx.rect(labelW, top + 1, plotW, laneH - 2); ctx.clip();
      ctx.strokeStyle = CH_COLOR[ch];
      ctx.lineWidth = o.big ? 1.6 : 1.3;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      const step = Math.max(1, Math.floor(n / (plotW * 1.5)));
      for (let k = 0; k < n; k += step) {
        const idx = (writeIdx - n + k + BUF * 2) % BUF;
        const x = labelW + (k / n) * plotW;
        const y = y0 - buf[ch][idx] * scale;
        if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.restore();
    });
  }

  function drawAll(force = false) {
    if (!dirty && !force) return;
    Object.values(canvases).forEach((c) => { if (rt.view === c.view) drawEEG(c.el, c.opts()); });
    dirty = false;
  }

  let lastFrame = performance.now(), lastDraw = 0, acc = 0;
  function frame(now) {
    let dt = (now - lastFrame) / 1000;
    lastFrame = now;
    if (dt > 0.5) dt = 0.5;
    if (!rt.paused) {
      acc += dt * FS;
      let n = Math.floor(acc);
      acc -= n;
      while (n-- > 0) pushSample();
    }
    const gap = reduceMotion.matches ? 1000 : 0;
    if (now - lastDraw >= gap) { drawAll(); lastDraw = now; }
    requestAnimationFrame(frame);
  }
  window.addEventListener('resize', () => drawAll(true));

  function updateOverlays() {
    $$('.eeg-overlay').forEach((ov) => {
      let msg = '';
      if (ov.dataset.overlay === 'mini' && !can('eeg')) msg = `Live EEG is not shared with you. ${WEARER.first} controls this in Care team.`;
      else if (!rt.connected) msg = 'Headset reconnecting. The signal comes back on its own.';
      else if (rt.phase === 'stim') msg = `Stimulation running. Sensors paused for ${rt.stimLeft} s because the current drowns out the EEG.`;
      ov.hidden = !msg;
      if (msg) ov.querySelector('p').textContent = msg;
    });
  }

  /* ---------- Live EEG panels ---------- */
  const BANDS = [
    { id: 'delta', name: 'Delta', range: '1–4 Hz' },
    { id: 'theta', name: 'Theta', range: '4–8 Hz' },
    { id: 'alpha', name: 'Alpha', range: '8–13 Hz' },
    { id: 'beta', name: 'Beta', range: '13–30 Hz' },
    { id: 'gamma', name: 'Gamma', range: '30–45 Hz' },
  ];
  function bandShares(ch) {
    const a = amps[ch];
    const p = {
      delta: a.delta ** 2 + (a.spike ** 2) * 0.7,
      theta: a.theta ** 2 + (a.spike ** 2) * 0.3,
      alpha: a.alpha ** 2,
      beta: a.beta ** 2,
      gamma: a.gamma ** 2,
    };
    const total = Object.values(p).reduce((s, v) => s + v, 0);
    return Object.fromEntries(Object.entries(p).map(([k, v]) => [k, (v / total) * 100]));
  }

  function buildReadouts() {
    $('#readouts').innerHTML = CH.map((ch) => `
      <div class="readout" data-ch="${ch}">
        <dt><span class="swatch" style="color:${CH_COLOR[ch]}" aria-hidden="true"></span>${ch}</dt>
        <dd><strong data-f="rms">0.0</strong> µV RMS</dd>
        <dd data-f="dom">Dominant: alpha</dd>
      </div>`).join('');
  }
  function updateReadouts(force = false) {
    if (rt.paused && !force) return;
    CH.forEach((ch) => {
      let s = 0;
      for (let i = 1; i <= FS; i++) { const v = buf[ch][(writeIdx - i + BUF) % BUF]; s += v * v; }
      const el = $(`.readout[data-ch="${ch}"]`);
      $('[data-f="rms"]', el).textContent = Math.sqrt(s / FS).toFixed(1);
      let dom;
      if (!rt.connected) dom = 'No signal';
      else if (rt.phase === 'stim') dom = 'Saturated by stimulation';
      else {
        const sh = bandShares(ch);
        const top = BANDS.reduce((best, b) => (sh[b.id] > sh[best.id] ? b : best), BANDS[0]);
        dom = `Dominant: ${top.name.toLowerCase()}`;
      }
      $('[data-f="dom"]', el).textContent = dom;
      el.dataset.off = String(!rt.channels[ch]);
    });
  }

  function buildBands() {
    $('#band-list').innerHTML = BANDS.map((b) => `
      <li class="band" data-band="${b.id}">
        <span class="band__name">${b.name}<small>${b.range}</small></span>
        <span class="band__bar" aria-hidden="true"><span></span></span>
        <span class="band__val" data-f="v">0%</span>
      </li>`).join('');
  }
  function updateBands(force = false) {
    if (rt.paused && !force) return;
    const sh = bandShares($('#band-channel').value);
    BANDS.forEach((b) => {
      const li = $(`.band[data-band="${b.id}"]`);
      $('.band__bar span', li).style.width = `${sh[b.id].toFixed(1)}%`;
      $('[data-f="v"]', li).textContent = `${R(sh[b.id])}%`;
    });
  }

  function buildMarkers() {
    $('#marker-rows').innerHTML = CATS.map((c) => `<tr data-cat="${c.id}"><td><strong>${c.name}</strong></td><td>${c.marker}</td><td class="mono" data-f="v"></td></tr>`).join('');
  }
  function updateMarkers() {
    CATS.forEach((c) => {
      const td = $(`#marker-rows tr[data-cat="${c.id}"] [data-f="v"]`);
      if (td) td.textContent = `${c.value(rt.risk[c.id])}, ${LEVEL_LABEL[level(rt.risk[c.id])].toLowerCase()}`;
    });
  }

  /* ---------- Device ---------- */
  const impQuality = (k) => (!rt.connected ? 'off' : k < 20 ? 'good' : k < 50 ? 'fair' : 'poor');
  const Q_LABEL = { good: 'Good', fair: 'Fair', poor: 'Poor', off: 'No contact' };
  const Q_LEVEL = { good: 'clear', fair: 'watch', poor: 'alert', off: 'clear' };

  function renderImpedance() {
    $('#dm-contacts').innerHTML = CH.map((ch) => {
      const q = impQuality(rt.impedance[ch]);
      return `<div class="contact" data-q="${q}"><strong>${ch}</strong><span>${Q_LABEL[q]}</span></div>`;
    }).join('');
    $('#impedance-list').innerHTML = CH.map((ch) => {
      const k = rt.impedance[ch];
      const q = impQuality(k);
      return `<li class="imp"><span class="imp__ch">${ch}</span><span class="meter" aria-hidden="true"><span class="meter__fill" data-level="${Q_LEVEL[q]}" style="width:${rt.connected ? clamp(100 - k, 5, 100) : 0}%"></span></span><span class="imp__val">${rt.connected ? `${k} kΩ` : 'None'}</span><span class="imp__q">${Q_LABEL[q]}</span></li>`;
    }).join('');
  }

  function updateDevice() {
    const el = Math.floor((Date.now() - rt.sessionStart) / 1000);
    $('#dm-session').textContent = `${pad(Math.floor(el / 3600))}:${pad(Math.floor(el / 60) % 60)}:${pad(el % 60)}`;
    ['#dm-battery', '#hs-battery'].forEach((s) => { $(s).textContent = `${rt.battery}%`; });
    ['#dm-signal', '#hs-signal'].forEach((s) => { $(s).textContent = rt.connected ? `${rt.signal} dBm` : 'None'; });
    const mins = Math.floor((Date.now() - rt.lastSync) / 60000);
    $('#hs-sync').textContent = mins < 1 ? 'just now' : `${mins} min ago`;
    ['#dm-chip', '#hs-chip'].forEach((s) => {
      const c = $(s);
      const state = rt.connected ? 'on' : 'off';
      if (c.dataset.state === state) return;
      c.dataset.state = state;
      c.className = `chip ${rt.connected ? 'chip--clear' : 'chip--warn'}`;
      c.innerHTML = rt.connected ? `${icon('check')}Connected` : `${icon('refresh')}Reconnecting`;
    });
  }

  function updateBadge() {
    const b = $('#stream-badge');
    let state = 'live', label = 'Demo stream';
    if (!rt.connected) { state = 'offline'; label = 'Reconnecting'; }
    else if (rt.phase === 'stim') { state = 'stim'; label = 'Stimulating'; }
    else if (rt.paused) { state = 'paused'; label = 'Display paused'; }
    b.dataset.state = state;
    $('#stream-label').textContent = label;
    $('#stream-time').textContent = rt.connected ? 'updated just now' : 'waiting for headset';
  }

  /* ---------- Reports ---------- */
  const TREND_H = 160;
  function allReports() {
    const map = new Map();
    SEEDED_REPORTS.forEach((r) => map.set(r.date, r));
    (store.customReports || []).forEach((r) => map.set(r.date, r));
    return Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date));
  }
  const crossings = (r) => CATS.filter((c) => r.cats[c.id].max >= th()).length;

  function reportSummary(r) {
    const over = CATS.filter((c) => r.cats[c.id].max >= th()).map((c) => c.name);
    const near = CATS.filter((c) => r.cats[c.id].max >= th() * 0.6 && r.cats[c.id].max < th()).map((c) => c.name);
    let s = over.length ? `${joinList(over)} passed the ${th()}% threshold at least once. Each crossing is listed in Alerts.` : `Every category stayed under the ${th()}% threshold.`;
    if (near.length) s += ` ${joinList(near)} came close.`;
    if (r.interventions) s += ` ${r.interventions} stimulation session${r.interventions > 1 ? 's' : ''} ran after consent.`;
    if (r.cats.depression.max >= th() * 0.6) s += ' Depression markers are worth raising at the next check-in.';
    return s;
  }

  function renderTrendCats() {
    const el = $('#trend-cats');
    if (!el.childElementCount) {
      el.innerHTML = CATS.map((c) => `<label><input type="radio" name="trend-cat" value="${c.id}"><span>${c.name}</span></label>`).join('');
      el.addEventListener('change', (e) => { rt.trendCat = e.target.value; renderTrend(); });
    }
    const r = $(`input[value="${rt.trendCat}"]`, el);
    if (r) r.checked = true;
  }

  function renderTrend() {
    const cat = rt.trendCat;
    const t = th();
    const days = TREND[cat].map((d) => ({ date: d.date, peak: d.peak }));
    days.push({ date: dayKey(new Date()), peak: rt.n ? R(rt.max[cat]) : 0, today: true });
    const scale = Math.max(50, t + 15, ...days.map((d) => d.peak + 5));
    const cols = days.map((d) => {
      const f = Math.min(d.peak, scale) / scale;
      return `<div class="trend__col"><div class="trend__bar" data-level="${level(d.peak)}" style="height:${(f * TREND_H).toFixed(1)}px"></div><div class="trend__label"${d.today ? ' style="font-weight:700;color:var(--c-ink)"' : ''}>${d.today ? 'Now' : fromKey(d.date).getDate()}</div></div>`;
    }).join('');
    $('#trend').innerHTML = `${cols}<div class="trend__gate" style="bottom:${(20 + (t / scale) * TREND_H).toFixed(1)}px"><span>${t}%</span></div>`;
    $('#trend-table').innerHTML = `<caption>Daily peak risk for ${CAT[cat].name}, last 14 days</caption><tr><th scope="col">Date</th><th scope="col">Peak risk</th></tr>${days.map((d) => `<tr><td>${d.today ? 'Today so far' : fmtShort.format(fromKey(d.date))}</td><td>${d.peak}%</td></tr>`).join('')}`;
  }

  function renderReportList() {
    const reports = allReports();
    if (!rt.selectedReport || !reports.some((r) => r.date === rt.selectedReport)) rt.selectedReport = reports[0]?.date || null;
    $('#report-list').innerHTML = reports.map((r) => {
      const n = crossings(r);
      const isToday = r.date === dayKey(new Date());
      return `<li><button class="report-item" type="button" data-report="${r.date}" aria-current="${r.date === rt.selectedReport}"><strong>${isToday ? 'Today' : fmtShort.format(fromKey(r.date))}</strong><span>${n ? `${n} crossing${n > 1 ? 's' : ''}` : 'No crossings'}, ${fmtMinutes(r.wearMin)}</span></button></li>`;
    }).join('');
  }

  function renderReportDetail() {
    const el = $('#report-detail');
    const r = allReports().find((x) => x.date === rt.selectedReport);
    if (!r) {
      el.innerHTML = '<p class="note">No reports yet. Build today\'s report to see one here.</p>';
      return;
    }
    const n = crossings(r);
    el.innerHTML = `
      <div class="card__head card__head--wrap">
        <h2>${fmtLong.format(fromKey(r.date))}</h2>
        <div class="btn-row report-actions">
          <button class="btn btn--sm btn--paper" type="button" data-report-dl>${icon('download')}Download</button>
          <button class="btn btn--sm btn--paper" type="button" data-report-print>${icon('printer')}Print</button>
        </div>
      </div>
      <div class="report-stats">
        <div class="report-stat"><strong>${fmtMinutes(r.wearMin)}</strong><span>Wear time</span></div>
        <div class="report-stat"><strong>${r.signal}%</strong><span>Signal quality</span></div>
        <div class="report-stat"><strong>${n}</strong><span>Threshold crossings</span></div>
        <div class="report-stat"><strong>${r.interventions}</strong><span>Stimulation sessions</span></div>
      </div>
      <p class="report-summary">${reportSummary(r)}</p>
      <h3 class="subhead">Average and peak risk</h3>
      <div class="report-cats">
        ${CATS.map((c) => {
          const v = r.cats[c.id];
          return `<div class="report-cat"><span class="report-cat__label">${c.name}</span><span class="meter" aria-hidden="true"><span class="meter__fill" data-level="${level(v.max)}" style="width:${clamp(v.max, 0, 100)}%"></span><span class="meter__gate" style="left:${th()}%"></span></span><span class="report-cat__vals">${v.avg}% / ${v.max}%</span></div>`;
        }).join('')}
      </div>
      <p class="note">Average / peak per category. The black tick marks the ${th()}% threshold. Simulated data, not medical advice.</p>`;
  }

  function renderReports() {
    const off = store.settings.idleMode === 'end';
    $('#reports-off').hidden = !off;
    $('#reports-on').hidden = off;
    if (off) return;
    renderTrendCats();
    renderTrend();
    renderReportList();
    renderReportDetail();
  }

  function reportText(r) {
    const lines = [
      'NeuroShield daily report',
      `Wearer: ${WEARER.name} (demo data)`,
      `Date: ${fmtLong.format(fromKey(r.date))}`,
      '',
      `Wear time: ${fmtMinutes(r.wearMin)}`,
      `Signal quality: ${r.signal}%`,
      `Threshold crossings: ${crossings(r)} (threshold ${th()}%)`,
      `Stimulation sessions: ${r.interventions}`,
      '',
      'Category        Avg    Peak',
      ...CATS.map((c) => `${c.name.padEnd(15)} ${String(r.cats[c.id].avg + '%').padEnd(6)} ${r.cats[c.id].max}%`),
      '',
      `Summary: ${reportSummary(r)}`,
      '',
      'Simulated data from a research prototype. Not medical advice.',
    ];
    return lines.join('\n');
  }

  function buildToday() {
    const n = Math.max(1, rt.n);
    const cats = {};
    CATS.forEach((c) => { cats[c.id] = { avg: R(rt.sum[c.id] / n), max: R(rt.max[c.id]) }; });
    const avgImp = CH.reduce((s, ch) => s + rt.impedance[ch], 0) / CH.length;
    const date = dayKey(new Date());
    const r = {
      date,
      wearMin: Math.max(1, R((Date.now() - rt.sessionStart) / 60000)),
      signal: R(clamp(100 - avgImp * 0.6, 40, 99)),
      interventions: rt.interventionsToday,
      cats,
    };
    store.customReports = (store.customReports || []).filter((x) => x.date !== date).concat(r);
    save();
    rt.selectedReport = date;
    renderReports();
  }

  /* ---------- Care team ---------- */
  const initials = (name) => name.replace(/^Dr\.?\s+/i, '').split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();

  function renderMembers() {
    const manage = rt.role === 'user';
    const dis = manage ? '' : 'disabled';
    const wearer = `
      <article class="card">
        <div class="card__head">
          <div class="member__id"><span class="avatar" aria-hidden="true">${initials(WEARER.name)}</span><div><p class="member__name">${WEARER.name}</p><p class="member__role">Wearer</p></div></div>
          <span class="chip chip--info">${icon('shield')}Owner</span>
        </div>
        <p class="card__sub">Full access to every reading. Always asked first when the safety gate opens.</p>
      </article>`;
    const cards = store.members.map((m) => `
      <article class="card" data-member="${m.id}">
        <div class="card__head">
          <div class="member__id"><span class="avatar" data-role="${m.role}" aria-hidden="true">${esc(initials(m.name))}</span><div><p class="member__name">${esc(m.name)}</p><p class="member__role">${ROLE_NAME[m.role]}${m.relation ? `, ${esc(m.relation)}` : ''}</p></div></div>
          ${m.status === 'pending' ? `<span class="chip chip--warn">${icon('clock')}Invite sent</span>` : `<span class="chip chip--clear">${icon('check')}Active</span>`}
        </div>
        <div class="perms">
          ${['eeg', 'alerts', 'approve'].map((p) => `
            <label class="toggle">
              <span>${PERM_LABEL[p]}</span>
              <span class="toggle__state" aria-hidden="true">${m.perms[p] ? 'On' : 'Off'}</span>
              <input type="checkbox" role="switch" data-perm="${p}" data-id="${m.id}" ${m.perms[p] ? 'checked' : ''} ${dis}>
              <span class="toggle__track" aria-hidden="true"></span>
            </label>`).join('')}
        </div>
        <div class="btn-row">
          <button class="btn btn--sm btn--paper" type="button" data-remove="${m.id}" ${dis}>${icon('trash')}${m.status === 'pending' ? 'Cancel invite' : 'Remove'}</button>
          ${m.status === 'pending' ? `<button class="btn btn--sm btn--paper" type="button" data-accept="${m.id}" ${dis}>${icon('check')}Mark as joined (demo)</button>` : ''}
        </div>
      </article>`).join('');
    $('#member-list').innerHTML = wearer + cards;
  }

  function setErr(id, msg) {
    const input = $(`#${id}`);
    const err = $(`#${id}-err`);
    input.setAttribute('aria-invalid', msg ? 'true' : 'false');
    err.hidden = !msg;
    err.innerHTML = msg ? `${icon('alert')}<span>${esc(msg)}</span>` : '';
    return !msg;
  }

  function updateInviteNote() {
    if (rt.role !== 'user') { $('#invite-note').textContent = `Only ${WEARER.first} can invite people.`; return; }
    $('#invite-note').textContent = $('#inv-role').value === 'doctor'
      ? 'New doctors can see live EEG and get alerts. You decide later whether they can approve stimulation.'
      : 'New parents get alerts only. You can widen access after they join.';
  }

  /* ---------- Role ---------- */
  function applyRole() {
    const m = actingMember();
    const hint = $('#role-hint');
    if (rt.role === 'user') hint.textContent = `${WEARER.name}. You control who sees your data.`;
    else if (!m) hint.textContent = `No active ${rt.role === 'doctor' ? 'doctor' : 'parent'} on the care team yet. Everything is read-only.`;
    else hint.textContent = `${m.name}${m.relation ? `, ${m.relation}` : ''}. Access set by ${WEARER.first}.`;

    const eeg = can('eeg');
    $('#live-locked').hidden = eeg;
    $('#live-content').hidden = !eeg;

    const tune = can('tune');
    ['#th-risk', '#th-onset'].forEach((s) => { $(s).disabled = !tune; });
    $('#th-lock').className = `chip ${tune ? 'chip--info' : 'chip--muted'}`;
    $('#th-lock').innerHTML = tune ? `${icon('sliders')}You can edit` : `${icon('lock')}Doctor only`;
    $('#th-note').textContent = tune ? 'Changes apply right away and are logged in Alerts.' : 'Only a doctor on the care team can change these.';

    const own = rt.role === 'user';
    $$('input[name="idle-mode"]').forEach((r) => { r.disabled = !own; });
    $('#pv-note').textContent = own ? '' : `Only ${WEARER.first} can change this.`;
    $('#reset-demo').disabled = false;

    $$('#invite-form input, #invite-form select, #invite-submit').forEach((x) => { x.disabled = !own; });
    updateInviteNote();
    $('#review-note').textContent = own ? '' : `You're viewing ${WEARER.first}'s events as ${actorName()}.`;

    renderMembers();
    updateConsentUI();
    updateOverlays();
    drawAll(true);
  }

  /* ---------- Dialog helpers ---------- */
  function showDialog(d) {
    $$('dialog[open]').forEach((o) => { if (o !== d) o.close(); });
    if (!d.open) d.showModal();
  }
  function confirmDialog(title, body, okLabel) {
    return new Promise((resolve) => {
      const d = $('#confirm-dialog');
      $('#cf-title').textContent = title;
      $('#cf-body').textContent = body;
      $('#cf-ok').textContent = okLabel;
      d.returnValue = '';
      d.addEventListener('close', () => resolve(d.returnValue === 'ok'), { once: true });
      showDialog(d);
      $('#cf-cancel').focus();
    });
  }
  $('#cf-ok').addEventListener('click', () => $('#confirm-dialog').close('ok'));
  $('#cf-cancel').addEventListener('click', () => $('#confirm-dialog').close('cancel'));

  $$('dialog').forEach((d) => {
    d.addEventListener('click', (e) => {
      if (e.target === d && d.id !== 'consent-dialog') d.close();
      if (e.target.closest('[data-close]')) d.close();
    });
  });

  // Busy state that keeps focus on the button (aria-disabled instead of disabled).
  function withBusy(btn, label, ms) {
    if (btn.getAttribute('aria-busy') === 'true') return null;
    const span = btn.querySelector('span');
    const old = span ? span.textContent : '';
    btn.setAttribute('aria-busy', 'true');
    btn.setAttribute('aria-disabled', 'true');
    if (span) span.textContent = label;
    return new Promise((res) => setTimeout(() => {
      btn.removeAttribute('aria-busy');
      btn.removeAttribute('aria-disabled');
      if (span) span.textContent = old;
      res();
    }, ms));
  }

  /* ---------- Routing ---------- */
  const VIEWS = { overview: 'Overview', live: 'Live EEG', alerts: 'Alerts', reports: 'Daily reports', care: 'Care team', device: 'Device & privacy' };
  function route(initial = false) {
    let v = location.hash.slice(1);
    if (!VIEWS[v]) v = 'overview';
    rt.view = v;
    $$('.view').forEach((s) => { s.hidden = s.dataset.view !== v; });
    $$('.nav__link').forEach((a) => { if (a.dataset.nav === v) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    $('#page-title').textContent = VIEWS[v];
    document.title = `${VIEWS[v]} | NeuroShield`;
    closeSidebar(false);
    if (!initial) {
      window.scrollTo(0, 0);
      $('#page-title').focus({ preventScroll: true });
    }
    if (v === 'reports') renderReports();
    if (v === 'live') { updateReadouts(true); updateBands(true); }
    if (v === 'alerts') renderEvents();
    requestAnimationFrame(() => drawAll(true));
  }
  window.addEventListener('hashchange', () => route());

  /* ---------- Sidebar (mobile drawer) ---------- */
  const sidebar = $('#sidebar'), scrim = $('#scrim'), menuBtn = $('#menu-btn'), mainWrap = $('.main-wrap');
  function syncDrawer() {
    const open = sidebar.dataset.open === 'true';
    if (!mqMobile.matches) {
      sidebar.dataset.open = 'false';
      sidebar.inert = false;
      mainWrap.inert = false;
      scrim.hidden = true;
      menuBtn.setAttribute('aria-expanded', 'false');
      return;
    }
    sidebar.inert = !open;
    mainWrap.inert = open;
    scrim.hidden = !open;
    menuBtn.setAttribute('aria-expanded', String(open));
  }
  function openSidebar() { sidebar.dataset.open = 'true'; syncDrawer(); $('.nav__link', sidebar).focus(); }
  function closeSidebar(returnFocus = true) {
    if (sidebar.dataset.open !== 'true') return;
    sidebar.dataset.open = 'false';
    syncDrawer();
    if (returnFocus) menuBtn.focus();
  }
  menuBtn.addEventListener('click', openSidebar);
  $('#sidebar-close').addEventListener('click', () => closeSidebar());
  scrim.addEventListener('click', () => closeSidebar());
  mqMobile.addEventListener('change', syncDrawer);

  /* ---------- Scenario menu ---------- */
  const scBtn = $('#scenario-btn'), scList = $('#scenario-list');
  function syncMenuItems() {
    $$('[data-scenario]', scList).forEach((b) => {
      const s = b.dataset.scenario;
      b.disabled = s === 'baseline' ? rt.phase === 'stim' : (rt.phase !== 'monitor' || !rt.connected);
    });
  }
  function openMenu() {
    syncMenuItems();
    scList.hidden = false;
    scBtn.setAttribute('aria-expanded', 'true');
    const first = $$('button:not(:disabled)', scList)[0];
    if (first) first.focus();
  }
  function closeMenu(focus = true) {
    if (scList.hidden) return;
    scList.hidden = true;
    scBtn.setAttribute('aria-expanded', 'false');
    if (focus) scBtn.focus();
  }
  scBtn.addEventListener('click', () => (scList.hidden ? openMenu() : closeMenu()));
  scBtn.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown') { e.preventDefault(); openMenu(); } });
  scList.addEventListener('keydown', (e) => {
    const items = $$('button:not(:disabled)', scList);
    const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    else if (e.key === 'Home') { e.preventDefault(); items[0].focus(); }
    else if (e.key === 'End') { e.preventDefault(); items[items.length - 1].focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); closeMenu(); }
    else if (e.key === 'Tab') closeMenu(false);
  });
  scList.addEventListener('click', (e) => {
    const b = e.target.closest('[data-scenario]');
    if (!b || b.disabled) return;
    closeMenu();
    runScenario(b.dataset.scenario);
  });
  document.addEventListener('click', (e) => { if (!$('#scenario-menu').contains(e.target)) closeMenu(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sidebar.dataset.open === 'true') closeSidebar(); });

  /* ---------- Wire up controls ---------- */
  $('.skip-link').addEventListener('click', (e) => {
    e.preventDefault();
    const m = $('#main');
    m.setAttribute('tabindex', '-1');
    m.focus();
  });

  $$('input[name="role"]').forEach((r) => r.addEventListener('change', () => {
    rt.role = r.value;
    applyRole();
    updateUI();
    toast(`Now viewing as ${actorName()} (${ROLE_NAME[rt.role].toLowerCase()}).`, 'info');
  }));

  // Overview
  $('#cat-grid').addEventListener('click', (e) => { const b = e.target.closest('.cat'); if (b) openCat(b.dataset.cat); });
  $('#hero-action').addEventListener('click', (e) => {
    if (e.currentTarget.dataset.act === 'consent') showConsentDialog();
    else location.hash = '#alerts';
  });
  $('#consent-banner-btn').addEventListener('click', showConsentDialog);
  $('#cd-approve').addEventListener('click', () => { if (can('approve')) closeConsent('approve'); });
  $('#cd-deny').addEventListener('click', () => { if (can('approve')) closeConsent('decline'); });

  // Live EEG
  $('#stream-toggle').addEventListener('click', (e) => {
    rt.paused = !rt.paused;
    const b = e.currentTarget;
    b.setAttribute('aria-pressed', String(rt.paused));
    b.innerHTML = rt.paused ? `${icon('play')}<span>Resume</span>` : `${icon('pause')}<span>Pause</span>`;
    updateBadge();
    announce(rt.paused ? 'EEG display paused. Monitoring continues.' : 'EEG display resumed.');
  });
  $$('input[name="timebase"]').forEach((r) => r.addEventListener('change', () => { rt.timebase = Number(r.value); drawAll(true); }));
  const GAINS = [0.5, 0.75, 1, 1.5, 2, 3];
  function setGain(dir) {
    const i = clamp(GAINS.indexOf(rt.gain) + dir, 0, GAINS.length - 1);
    rt.gain = GAINS[i];
    $('#gain-out').textContent = `${rt.gain.toFixed(rt.gain % 1 ? 2 : 1).replace(/0$/, '')}×`;
    $('#gain-down').disabled = i === 0;
    $('#gain-up').disabled = i === GAINS.length - 1;
    drawAll(true);
  }
  $('#gain-down').addEventListener('click', () => setGain(-1));
  $('#gain-up').addEventListener('click', () => setGain(1));
  $$('.channel-toggles input').forEach((c) => c.addEventListener('change', () => {
    rt.channels[c.value] = c.checked;
    updateReadouts(true);
    drawAll(true);
  }));
  $('#band-channel').addEventListener('change', () => updateBands(true));

  // Alerts
  $$('input[name="alert-filter"]').forEach((r) => r.addEventListener('change', () => { rt.alertFilter = r.value; renderEvents(); }));
  $('[data-filter-reset]').addEventListener('click', () => {
    rt.alertFilter = 'all';
    $('input[name="alert-filter"][value="all"]').checked = true;
    renderEvents();
  });
  $('#event-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-review]');
    if (!b) return;
    const ev = store.events.find((x) => x.id === b.dataset.review);
    if (!ev) return;
    const items = $$('[data-review]');
    const nextId = items[items.indexOf(b) + 1]?.dataset.review;
    ev.status = 'reviewed';
    ev.detail = `${ev.detail} Reviewed by ${actorName()}.`;
    save();
    renderEvents();
    renderRecent();
    updateCounts();
    toast('Marked as reviewed.', 'ok');
    const next = nextId && $(`[data-review="${nextId}"]`);
    if (next) next.focus(); else $('#page-title').focus();
  });
  $('#export-csv').addEventListener('click', () => {
    const rows = [['time', 'type', 'category', 'title', 'detail', 'status', 'risk_percent']]
      .concat(store.events.map((e) => [new Date(e.t).toISOString(), e.type, e.cat || '', e.title, e.detail || '', e.status || '', e.risk ?? '']));
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    download(`neuroshield-events-${dayKey(new Date())}.csv`, csv, 'text/csv;charset=utf-8');
    toast(`Exported ${store.events.length} events as CSV.`, 'ok');
  });

  // Reports
  $('#report-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-report]');
    if (!b) return;
    rt.selectedReport = b.dataset.report;
    renderReportList();
    renderReportDetail();
    $(`[data-report="${rt.selectedReport}"]`).focus();
  });
  $('#report-detail').addEventListener('click', (e) => {
    const r = allReports().find((x) => x.date === rt.selectedReport);
    if (!r) return;
    if (e.target.closest('[data-report-dl]')) {
      download(`neuroshield-report-${r.date}.txt`, reportText(r), 'text/plain;charset=utf-8');
      toast('Report downloaded.', 'ok');
    }
    if (e.target.closest('[data-report-print]')) window.print();
  });
  $('#gen-report').addEventListener('click', async (e) => {
    const p = withBusy(e.currentTarget, 'Building…', 700);
    if (!p) return;
    await p;
    buildToday();
    toast("Today's report is ready.", 'ok');
  });

  // Care team
  $('#member-list').addEventListener('change', (e) => {
    const input = e.target.closest('[data-perm]');
    if (!input || rt.role !== 'user') return;
    const m = store.members.find((x) => x.id === input.dataset.id);
    if (!m) return;
    const p = input.dataset.perm;
    m.perms[p] = input.checked;
    input.closest('.toggle').querySelector('.toggle__state').textContent = input.checked ? 'On' : 'Off';
    save();
    addEvent({ type: 'system', kind: 'system', title: `Access changed for ${m.name}`, detail: `${PERM_LABEL[p]} turned ${input.checked ? 'on' : 'off'} by ${WEARER.first}.` });
    toast(`${m.name} ${input.checked ? 'can now' : 'can no longer'} ${PERM_TEXT[p]}.`, 'ok');
  });
  $('#member-list').addEventListener('click', async (e) => {
    const rm = e.target.closest('[data-remove]');
    const ac = e.target.closest('[data-accept]');
    if (rt.role !== 'user') return;
    if (rm) {
      const m = store.members.find((x) => x.id === rm.dataset.remove);
      if (!m) return;
      const pending = m.status === 'pending';
      const ok = await confirmDialog(
        pending ? `Cancel invite for ${m.name}?` : `Remove ${m.name}?`,
        pending ? 'The invite link stops working right away.' : `${m.name} loses access to ${WEARER.first}'s data right away. Past events stay in the log.`,
        pending ? 'Cancel invite' : 'Remove',
      );
      if (!ok) return;
      store.members = store.members.filter((x) => x.id !== m.id);
      save();
      renderMembers();
      addEvent({ type: 'system', kind: 'system', title: pending ? `Invite cancelled for ${m.name}` : `${m.name} removed from care team`, detail: `Change made by ${WEARER.first}.` });
      toast(pending ? 'Invite cancelled.' : `${m.name} removed.`, 'ok');
      $('#page-title').focus();
    }
    if (ac) {
      const m = store.members.find((x) => x.id === ac.dataset.accept);
      if (!m) return;
      m.status = 'active';
      save();
      renderMembers();
      addEvent({ type: 'system', kind: 'system', title: `${m.name} joined the care team`, detail: `${ROLE_NAME[m.role]}. Access: ${Object.entries(m.perms).filter(([, v]) => v).map(([k]) => PERM_TEXT[k]).join(', ') || 'none'}.` });
      toast(`${m.name} is now active.`, 'ok');
      applyRole();
    }
  });

  $('#inv-role').addEventListener('change', updateInviteNote);
  ['inv-name', 'inv-email'].forEach((id) => $(`#${id}`).addEventListener('input', () => setErr(id, '')));
  $('#invite-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (rt.role !== 'user') return;
    const name = $('#inv-name').value.trim();
    const email = $('#inv-email').value.trim().toLowerCase();
    const role = $('#inv-role').value;
    const relation = $('#inv-relation').value.trim();
    const okName = setErr('inv-name', name ? '' : "Enter the person's full name.");
    let emailMsg = '';
    if (!email) emailMsg = 'Enter an email address.';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) emailMsg = 'Enter an email like name@example.com.';
    else if (store.members.some((m) => m.email === email)) emailMsg = 'This person is already on the care team.';
    const okEmail = setErr('inv-email', emailMsg);
    if (!okName || !okEmail) { $(okName ? '#inv-email' : '#inv-name').focus(); return; }
    const btn = $('#invite-submit');
    btn.setAttribute('aria-busy', 'true');
    btn.disabled = true;
    btn.textContent = 'Sending…';
    await new Promise((r) => setTimeout(r, 700));
    store.members.push({
      id: uid(), name, email, role, relation, status: 'pending',
      perms: role === 'doctor' ? { eeg: true, alerts: true, approve: false } : { eeg: false, alerts: true, approve: false },
    });
    save();
    renderMembers();
    e.target.reset();
    btn.removeAttribute('aria-busy');
    btn.disabled = false;
    btn.textContent = 'Send invite';
    updateInviteNote();
    addEvent({ type: 'system', kind: 'system', title: `Invite sent to ${name}`, detail: `${ROLE_NAME[role]} invited by ${WEARER.first} (${email}).` });
    toast(`Invite sent to ${email}.`, 'ok');
    $('#inv-name').focus();
  });

  // Device & privacy
  function applySettingsToInputs() {
    $('#th-risk').value = store.settings.thRisk;
    $('#th-onset').value = store.settings.thOnset;
    $('#th-risk-out').textContent = `${store.settings.thRisk}%`;
    $('#th-onset-out').textContent = `${store.settings.thOnset} min`;
    const r = $(`input[name="idle-mode"][value="${store.settings.idleMode}"]`);
    if (r) r.checked = true;
  }
  $('#th-risk').addEventListener('input', (e) => { $('#th-risk-out').textContent = `${e.target.value}%`; });
  $('#th-onset').addEventListener('input', (e) => { $('#th-onset-out').textContent = `${e.target.value} min`; });
  ['#th-risk', '#th-onset'].forEach((s) => $(s).addEventListener('change', () => {
    if (!can('tune')) { applySettingsToInputs(); return; }
    store.settings.thRisk = Number($('#th-risk').value);
    store.settings.thOnset = Number($('#th-onset').value);
    save();
    addEvent({ type: 'system', kind: 'system', title: 'Safety gate changed', detail: `Now opens above ${th()}% risk with onset within ${thOnset()} min. Changed by ${actorName()}.` });
    toast(`Safety gate: above ${th()}%, onset within ${thOnset()} min.`, 'ok');
    updateUI();
  }));
  $$('input[name="idle-mode"]').forEach((r) => r.addEventListener('change', () => {
    if (rt.role !== 'user') { applySettingsToInputs(); return; }
    store.settings.idleMode = r.value;
    save();
    const on = r.value === 'report';
    addEvent({ type: 'system', kind: 'system', title: on ? 'Daily reports turned on' : 'Daily reports turned off', detail: on ? 'Processed aggregates are kept for one end-of-day summary.' : 'The stream ends when nothing is detected. Only alerts are saved.' });
    toast(on ? 'Daily reports are on.' : 'Daily reports are off. Only alerts are kept.', 'ok');
  }));

  $('#check-electrodes').addEventListener('click', async (e) => {
    if (!rt.connected) { toast('Connect the headset first.', 'info'); return; }
    const p = withBusy(e.currentTarget, 'Checking…', 1800);
    if (!p) return;
    await p;
    CH.forEach((ch) => { rt.impedance[ch] = R(8 + Math.random() * 12); });
    if (Math.random() < 0.35) rt.impedance[CH[Math.floor(Math.random() * 4)]] = R(24 + Math.random() * 18);
    renderImpedance();
    const good = CH.filter((ch) => impQuality(rt.impedance[ch]) === 'good').length;
    const fair = CH.filter((ch) => impQuality(rt.impedance[ch]) !== 'good').map((ch) => ch);
    addEvent({ type: 'system', kind: 'system', title: `Electrode check: ${good} of 4 good`, detail: fair.length ? `${joinList(fair)} could sit closer to the skin. The polymer re-hydrates within a few minutes.` : 'All contacts under 20 kΩ.' });
    toast(fair.length ? `${good} of 4 electrodes good. Adjust ${joinList(fair)}.` : 'All four electrodes have good contact.', fair.length ? 'info' : 'ok');
  });
  $('#sync-now').addEventListener('click', async (e) => {
    if (!rt.connected) { toast('Connect the headset first.', 'info'); return; }
    const p = withBusy(e.currentTarget, 'Syncing…', 1200);
    if (!p) return;
    await p;
    rt.lastSync = Date.now();
    updateDevice();
    toast('Synced with the cloud.', 'ok');
  });
  $('#repair').addEventListener('click', async (e) => {
    if (rt.phase !== 'monitor') { toast('Wait until the current safety event is resolved.', 'info'); return; }
    const p = withBusy(e.currentTarget, 'Pairing…', 3000);
    if (!p) return;
    rt.connected = false;
    renderImpedance();
    updateUI();
    addEvent({ type: 'system', kind: 'system', title: 'Headset disconnected for re-pairing', detail: 'Monitoring paused while Bluetooth LE reconnects.' });
    await p;
    rt.connected = true;
    renderImpedance();
    updateUI();
    addEvent({ type: 'system', kind: 'system', title: 'Headset paired again', detail: 'Encrypted stream resumed.' });
    toast('Headset paired again. Monitoring resumed.', 'ok');
  });
  $('#reset-demo').addEventListener('click', async () => {
    const ok = await confirmDialog('Clear demo data?', 'Settings, care team changes, events and built reports in this browser go back to the starting demo.', 'Clear demo data');
    if (!ok) return;
    try { localStorage.removeItem(STORE_KEY); } catch { /* ignore */ }
    location.reload();
  });

  /* ---------- Init ---------- */
  buildCats();
  buildReadouts();
  buildBands();
  buildMarkers();
  computeAmps();
  for (let i = 0; i < BUF; i++) pushSample();
  applySettingsToInputs();
  renderImpedance();
  renderRecent();
  renderEvents();
  updateCounts();
  applyRole();
  syncDrawer();
  route(true);
  updateUI();
  setInterval(tick, 1000);
  requestAnimationFrame(frame);
})();
