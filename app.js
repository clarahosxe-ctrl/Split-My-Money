'use strict';
/* Split My Money — gestion de budget de foyer. Tout est stocké en local (localStorage). */

const KEY = 'splitmymoney.v1';
const $ = (s, r = document) => r.querySelector(s);
const uid = () => Math.random().toString(36).slice(2, 9);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eur = n => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(n || 0);
const pct = n => `${Math.round(n * 100)}%`;
const num = v => { const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : 0; };

const KINDS = {
  fixed: { label: 'Charges fixes', one: 'Charge fixe', icon: '🏠', hint: 'Loyer, abonnements, assurances…' },
  envelope: { label: 'Enveloppes', one: 'Enveloppe', icon: '✉️', hint: 'Budget mensuel à dépenser : courses, sorties…' },
  savings: { label: 'Épargne', one: 'Épargne', icon: '🐷', hint: 'Mise de côté chaque mois vers un objectif' }
};

/* ---------- État ---------- */
function seed() {
  const mk = (scope, kind, name, icon, amount, extra = {}) => ({ id: uid(), scope, kind, name, icon, amount, ...extra });
  const half = { mode: 'half', pct: 50 }, sal = { mode: 'salary', pct: 50 };
  return {
    members: [
      { id: 'a', name: 'Moi', color: '#6c4cf1', salary: 2200 },
      { id: 'b', name: 'Partenaire', color: '#ff7a9c', salary: 1800 }
    ],
    items: [
      mk('common', 'fixed', 'Loyer', '🏠', 1100, { split: sal }),
      mk('common', 'fixed', 'Électricité & internet', '💡', 120, { split: half }),
      mk('common', 'envelope', 'Courses', '🛒', 500, { split: half }),
      mk('common', 'envelope', 'Sorties & restos', '🍽️', 200, { split: { mode: 'percent', pct: 60 } }),
      mk('common', 'savings', 'Voyage', '✈️', 150, { split: half, target: 3000, balance0: 600 }),
      mk('common', 'savings', 'Sécurité', '🛟', 100, { split: sal, target: 5000, balance0: 1200 }),
      mk('a', 'fixed', 'Abonnement téléphone', '📱', 20),
      mk('a', 'envelope', 'Shopping', '🛍️', 100),
      mk('a', 'envelope', 'Beauté', '💅', 50),
      mk('a', 'savings', 'Épargne perso', '💰', 80, { target: 2000, balance0: 300 }),
      mk('b', 'fixed', 'Salle de sport', '🏋️', 35),
      mk('b', 'envelope', 'Loisirs', '🎮', 80),
      mk('b', 'savings', 'Projet perso', '🎯', 60, { target: 1500, balance0: 0 })
    ],
    txs: []
  };
}
let state;
function prefs() { return state.prefs || (state.prefs = { theme: 'classic', mode: 'auto' }); }
const ui = { view: 'home', pers: 'a', month: new Date().toISOString().slice(0, 7) };

function load() {
  let st = null;
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && s.members && s.items) st = s; } catch (e) { /* ignore */ }
  return migrate(st || seed());
}

/** Ajouts de données ponctuels (appliqués une seule fois par appareil, repérés par un drapeau). */
const CLARA_ITEMS = [
  ['fixed', 'Téléphone', '📱', 10], ['fixed', 'Spotify', '🎧', 15], ['fixed', 'ChatGPT', '🤖', 8],
  ['fixed', 'Claude', '🧠', 22], ['fixed', 'Apple', '🍎', 1], ['fixed', 'Google', '🔎', 2],
  ['envelope', 'Vêtements', '👗', 100], ['envelope', 'Beauté / coiffure', '💅', 40], ['envelope', 'Amazon / achats divers', '📦', 50],
  ['envelope', 'Loisirs personnels', '🎨', 50], ['envelope', 'Cadeaux', '🎁', 30], ['envelope', 'Projet entreprise', '💼', 50],
  ['savings', 'Épargne personnelle', '💰', 30]
];
const DEMO_PERSO_A = [['Abonnement téléphone', 20], ['Shopping', 100], ['Beauté', 50], ['Épargne perso', 80]];
function migrate(st) {
  st.migrations = st.migrations || {};
  if (!st.migrations.clara1 && st.members[0]) {
    const owner = st.members[0].id;
    // retire d'abord les lignes d'exemple restées intactes, pour éviter les doublons
    st.items = st.items.filter(i => !(i.scope === owner && DEMO_PERSO_A.some(([n, a]) => i.name === n && i.amount === a)));
    for (const [kind, name, icon, amount] of CLARA_ITEMS) {
      if (!st.items.some(i => i.scope === owner && i.name === name)) st.items.push({ id: uid(), scope: owner, kind, name, icon, amount, ...(kind === 'savings' ? { target: 0, balance0: 0 } : {}) });
    }
    st.migrations.clara1 = true;
  }
  return st;
}
state = load();

function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ignore */ } }

/* ---------- Calculs ---------- */
const memberById = id => state.members.find(m => m.id === id);
const totalSalary = () => state.members.reduce((s, m) => s + m.salary, 0);

/** Part (0..1) d'un membre pour un élément commun. */
function share(item, memberId) {
  if (item.scope !== 'common') return item.scope === memberId ? 1 : 0;
  const idx = state.members.findIndex(m => m.id === memberId);
  const { mode, pct: p } = item.split || { mode: 'half' };
  if (mode === 'percent') return idx === 0 ? p / 100 : 1 - p / 100;
  if (mode === 'salary') { const t = totalSalary(); return t > 0 ? state.members[idx].salary / t : 0.5; }
  return 0.5;
}
const splitLabel = it => {
  const [a, b] = state.members.map(m => share(it, m.id));
  const m = it.split.mode;
  return m === 'half' ? '50 / 50' : m === 'percent' ? `${pct(a)} / ${pct(b)}` : `Selon salaires · ${pct(a)} / ${pct(b)}`;
};
const monthTxs = (itemId, month = ui.month) => state.txs.filter(t => t.itemId === itemId && t.date.startsWith(month));
const spent = it => monthTxs(it.id).reduce((s, t) => s + t.amount, 0);
const saved = it => (it.balance0 || 0) + state.txs.filter(t => t.itemId === it.id).reduce((s, t) => s + t.amount, 0);
const itemsOf = (scope, kind) => state.items.filter(i => i.scope === scope && (!kind || i.kind === kind));

/** Détail mensuel d'un membre. */
function memberSummary(m) {
  const part = kind => itemsOf('common', kind).reduce((s, i) => s + i.amount * share(i, m.id), 0);
  const own = kind => itemsOf(m.id, kind).reduce((s, i) => s + i.amount, 0);
  const r = {
    cFixed: part('fixed'), cEnv: part('envelope'), cSav: part('savings'),
    pFixed: own('fixed'), pEnv: own('envelope'), pSav: own('savings')
  };
  r.total = Object.values(r).reduce((a, b) => a + b, 0);
  r.left = m.salary - r.total;
  return r;
}

/** Dépenses communes du mois avec leur payeur, soldes de chacun et remboursements déjà faits. */
function settlement() {
  const bal = Object.fromEntries(state.members.map(m => [m.id, 0]));
  const paid = { ...bal }, due = { ...bal };
  const rows = [];
  const add = (it, amount, payer, date, note, txId) => {
    rows.push({ it, amount, payer, date, note, txId });
    paid[payer] += amount;
    for (const m of state.members) due[m.id] += amount * share(it, m.id);
  };
  for (const it of itemsOf('common', 'fixed')) if (it.payer && memberById(it.payer)) add(it, it.amount, it.payer, '', 'Chaque mois');
  for (const t of state.txs) {
    const it = state.items.find(i => i.id === t.itemId);
    if (it && it.scope === 'common' && t.payer && t.date.startsWith(ui.month)) add(it, t.amount, t.payer, t.date, t.note, t.id);
  }
  const settles = (state.settles || []).filter(r => r.date.startsWith(ui.month));
  for (const m of state.members) bal[m.id] = paid[m.id] - due[m.id];
  for (const r of settles) { bal[r.from] += r.amount; bal[r.to] -= r.amount; }
  return { any: rows.length > 0 || settles.length > 0, bal, paid, due, rows, settles };
}

/* ---------- Rendu ---------- */
const svg = d => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const NAV = [
  ['home', svg('<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9.5h13V10"/><path d="M10 19.5v-5h4v5"/>'), 'Accueil'],
  ['common', svg('<circle cx="9" cy="8.5" r="3.2"/><path d="M3 19c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/><circle cx="17" cy="9.5" r="2.4"/><path d="M17.5 14c2.2.2 3.8 1.9 3.8 4.5"/>'), 'Commun'],
  ['debts', svg('<path d="M7 4h10v16l-2-1.4-1.5 1.4L12 18.6 10.5 20 9 18.6 7 20z"/><path d="M10 9h4M10 12.5h4"/>'), 'Décompte'],
  ['pers', svg('<circle cx="12" cy="8" r="3.6"/><path d="M5 20c0-3.9 3.1-6.5 7-6.5s7 2.6 7 6.5"/>'), 'Perso'],
  ['settings', svg('<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>'), 'Réglages']
];
const SUBS = { home: 'Ton foyer en un coup d’œil', common: 'Charges, enveloppes et épargne partagées', debts: 'Qui a payé quoi et qui doit combien', pers: 'Ce qui n’est qu’à toi', settings: 'Apparence, salaires et données' };
const TITLES = { home: 'Vue d’ensemble', common: 'Budget commun', debts: 'Décompte du mois', pers: 'Budget individuel', settings: 'Réglages' };

function render() {
  const nav = NAV.map(([k, ic, l]) => `<button data-act="nav" data-v="${k}" class="${ui.view === k ? 'on' : ''}"><b>${ic}</b>${l}</button>`).join('');
  $('#tabbar').innerHTML = nav;
  document.documentElement.dataset.theme = prefs().theme;
  document.documentElement.dataset.mode = prefs().mode === 'auto' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : prefs().mode;
  $('.fab').style.display = ui.view === 'settings' ? 'none' : '';
  $('#sub').textContent = SUBS[ui.view];
  $('#title').textContent = TITLES[ui.view];
  const [y, mo] = ui.month.split('-');
  $('#monthLabel').textContent = new Date(+y, +mo - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  $('.month').style.display = ui.view === 'settings' ? 'none' : '';
  $('#view').innerHTML = { home: viewHome, common: viewCommon, debts: viewDebts, pers: viewPers, settings: viewSettings }[ui.view]();
  save();
}

const colorDot = c => `<span class="dot" style="background:${c}"></span>`;
const signed = n => `<span class="${n < 0 ? 'neg' : 'pos'}">${eur(n)}</span>`;

function viewHome() {
  const sums = state.members.map(m => ({ m, s: memberSummary(m) }));
  const salary = totalSalary();
  const left = sums.reduce((a, x) => a + x.s.left, 0);
  const common = state.items.filter(i => i.scope === 'common');
  const cTotal = common.reduce((s, i) => s + i.amount, 0);
  const byKind = k => common.filter(i => i.kind === k).reduce((s, i) => s + i.amount, 0);
  const segs = [['Charges fixes', byKind('fixed'), '#6c4cf1'], ['Enveloppes', byKind('envelope'), '#ff7a9c'], ['Épargne', byKind('savings'), '#1fb98f']];
  let acc = 0;
  const grad = cTotal ? segs.map(([, v, c]) => { const a = acc; acc += v / cTotal * 100; return `${c} ${a}% ${acc}%`; }).join(',') : 'var(--line) 0 100%';
  const st = settlement();
  const [A, B] = state.members;

  const memberCard = ({ m, s }) => {
    const parts = [['Part commune', s.cFixed + s.cEnv + s.cSav, m.color], ['Fixes perso', s.pFixed, '#f5a524'], ['Enveloppes perso', s.pEnv, '#ff7a9c'], ['Épargne perso', s.pSav, '#1fb98f']];
    const base = Math.max(m.salary, s.total, 1);
    return `<div class="card">
      <div class="who">${colorDot(m.color)}${esc(m.name)}</div>
      <div class="lbl">Reste à vivre</div><div class="big">${signed(s.left)}</div>
      <div class="stack">${parts.map(([, v, c]) => `<i style="width:${v / base * 100}%;background:${c}"></i>`).join('')}</div>
      <div class="line"><span>Salaire net</span><b>${eur(m.salary)}</b></div>
      <div class="line"><span>Charges communes</span><span>${eur(s.cFixed)}</span></div>
      <div class="line"><span>Enveloppes communes</span><span>${eur(s.cEnv)}</span></div>
      <div class="line"><span>Épargne commune</span><span>${eur(s.cSav)}</span></div>
      <div class="line"><span>Charges perso</span><span>${eur(s.pFixed)}</span></div>
      <div class="line"><span>Enveloppes perso</span><span>${eur(s.pEnv)}</span></div>
      <div class="line"><span>Épargne perso</span><span>${eur(s.pSav)}</span></div>
      <div class="line total"><span>Total engagé</span><span>${eur(s.total)}</span></div>
    </div>`;
  };

  const envs = state.items.filter(i => i.kind === 'envelope' && spent(i) > 0)
    .sort((x, y) => spent(y) / y.amount - spent(x) / x.amount).slice(0, 6);
  const savs = state.items.filter(i => i.kind === 'savings' && i.target);

  return `
  <div class="card">
    <div class="lbl">Reste à vivre du foyer · par mois</div>
    <div class="big ${left < 0 ? 'neg' : ''}">${eur(left)}</div>
    <div class="mini-row">
      <div class="mini g">Revenus nets<b>${eur(salary)}</b></div>
      <div class="mini p">Engagé<b>${eur(salary - left)}</b></div>
      <div class="mini y">Épargne / mois<b>${eur(state.items.filter(i => i.kind === 'savings').reduce((s, i) => s + i.amount, 0))}</b></div>
    </div>
  </div>
  <div class="grid g2" style="margin-top:12px">${sums.map(memberCard).join('')}</div>
  <div class="grid g2" style="margin-top:12px">
    <div class="card"><h2>Répartition du budget commun</h2>
      <div class="donut-wrap">
        <div class="donut" style="background:conic-gradient(${grad})"><b><span>${eur(cTotal)}<br><small class="lbl">/ mois</small></span></b></div>
        <div style="flex:1;min-width:150px">${segs.map(([l, v, c]) => `<div class="line"><span>${colorDot(c)} ${l}</span><b>${eur(v)}</b></div>`).join('')}</div>
      </div>
    </div>
    <div class="card"><h2>Équilibre du mois</h2>
      ${st.any ? (() => {
        const a = st.bal[A.id];
        return Math.abs(a) < 0.01 ? '<div class="notice ok">Tout est équilibré 🎉</div>'
          : `<div class="notice">${esc((a < 0 ? A : B).name)} doit <b>${eur(Math.abs(a))}</b> à ${esc((a < 0 ? B : A).name)}</div>
             <p class="lbl"><a href="#" data-act="nav" data-v="debts" style="color:inherit">Voir le détail du décompte</a></p>`;
      })() : '<p class="lbl">Note des dépenses sur les enveloppes communes en indiquant qui a payé : le calcul « qui doit combien » apparaîtra ici.</p>'}
    </div>
  </div>
  <div class="grid g2" style="margin-top:12px">
    <div class="card"><h2>Enveloppes ce mois-ci</h2>
      ${envs.length ? envs.map(i => `<div style="margin-bottom:12px"><div class="meta"><span>${i.icon} ${esc(i.name)}</span><span>${eur(spent(i))} / ${eur(i.amount)}</span></div>${envBar(i)}</div>`).join('') : '<p class="lbl">Aucune dépense notée ce mois-ci.</p>'}
    </div>
    <div class="card"><h2>Objectifs d’épargne</h2>
      ${savs.length ? savs.map(i => `<div style="margin-bottom:12px"><div class="meta"><span>${i.icon} ${esc(i.name)} ${i.scope === 'common' ? '· commun' : '· ' + esc(memberById(i.scope).name)}</span><span>${eur(saved(i))} / ${eur(i.target)}</span></div>${savBar(i)}</div>`).join('') : '<p class="lbl">Aucun objectif défini.</p>'}
    </div>
  </div>`;
}

function envBar(i) {
  const r = i.amount ? spent(i) / i.amount : 0;
  return `<div class="bar ${r > 1 ? 'bad' : r > .8 ? 'warn' : ''}"><i style="width:${Math.min(r, 1) * 100}%"></i></div>`;
}
function savBar(i) {
  return `<div class="bar sav"><i style="width:${i.target ? Math.min(saved(i) / i.target, 1) * 100 : 0}%"></i></div>`;
}

function itemCard(it) {
  const common = it.scope === 'common';
  const chips = common ? `<div class="chips"><span class="chip">${splitLabel(it)}</span>${it.payer && memberById(it.payer) ? `<span class="chip">Payé par ${esc(memberById(it.payer).name)}</span>` : ''}${state.members.map(m => `<span class="chip"><i style="background:${m.color}"></i>${esc(m.name)} ${eur(it.amount * share(it, m.id))}</span>`).join('')}</div>` : '';
  let body = '';
  const txs = monthTxs(it.id).sort((a, b) => b.date.localeCompare(a.date));
  if (it.kind === 'envelope') {
    const s = spent(it), left = it.amount - s;
    body = `${envBar(it)}<div class="meta"><span>Dépensé ${eur(s)}</span><span class="${left < 0 ? 'neg' : ''}">${left < 0 ? 'Dépassé de ' + eur(-left) : 'Reste ' + eur(left)}</span></div>`;
  } else if (it.kind === 'savings') {
    const b = saved(it);
    let extra = '';
    if (it.target) {
      const rest = Math.max(it.target - b, 0);
      const months = it.amount > 0 ? Math.ceil(rest / it.amount) : null;
      extra = rest === 0 ? 'Objectif atteint 🎉' : months ? `Encore ${months} mois` : '';
    }
    body = `${it.target ? savBar(it) : ''}<div class="meta"><span>Épargné ${eur(b)}${it.target ? ' / ' + eur(it.target) : ''}</span><span>${extra}</span></div>`;
  }
  const canTx = it.kind !== 'fixed';
  const txLbl = it.kind === 'savings' ? 'Versement' : 'Dépense';
  return `<div class="item k-${it.kind}">
    <div class="item-top"><div class="emoji">${esc(it.icon)}</div>
      <div class="nm">${esc(it.name)}<small>${KINDS[it.kind].one}${common ? ' commune' : ''}</small></div>
      <div class="amt">${eur(it.amount)}<small class="lbl" style="display:block">/ mois</small></div></div>
    ${chips}${body}
    <div class="acts">
      ${canTx ? `<button class="btn sm ${it.kind === 'savings' ? 'inc' : 'exp'}" data-act="tx" data-id="${it.id}">${it.kind === 'savings' ? '+' : '−'} ${txLbl}</button>` : ''}
      <button class="btn soft sm" data-act="edit" data-id="${it.id}">Modifier</button>
      <button class="btn ghost sm" data-act="del" data-id="${it.id}">Supprimer</button>
    </div>
    ${canTx && txs.length ? `<details><summary>${txs.length} ${it.kind === 'savings' ? 'versement(s)' : 'dépense(s)'} ce mois-ci</summary>
      ${txs.map(t => `<div class="tx"><span>${new Date(t.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} · ${esc(t.note || txLbl)}${t.payer ? ' · ' + esc(memberById(t.payer)?.name || '') : ''}</span><span><b>${eur(t.amount)}</b> <button data-act="deltx" data-id="${t.id}" aria-label="Supprimer">✕</button></span></div>`).join('')}</details>` : ''}
  </div>`;
}

function section(scope, kind) {
  const list = itemsOf(scope, kind);
  const total = list.reduce((s, i) => s + i.amount, 0);
  return `<div class="sec-head"><div><h2>${KINDS[kind].label}</h2><span class="sum">${KINDS[kind].hint} · ${eur(total)}/mois</span></div>
    <button class="btn soft sm" data-act="add" data-scope="${scope}" data-kind="${kind}">+ Ajouter</button></div>
    ${list.length ? `<div class="grid g2">${list.map(itemCard).join('')}</div>` : '<div class="empty">Rien pour le moment.</div>'}`;
}

function viewCommon() {
  const [A, B] = state.members;
  const list = state.items.filter(i => i.scope === 'common');
  const tot = list.reduce((s, i) => s + i.amount, 0);
  const a = list.reduce((s, i) => s + i.amount * share(i, A.id), 0);
  return `<div class="card"><div class="lbl">Total des dépenses communes · par mois</div><div class="big">${eur(tot)}</div>
    <div class="mini-row"><div class="mini">${esc(A.name)} paie<b>${eur(a)} · ${pct(tot ? a / tot : .5)}</b></div>
    <div class="mini">${esc(B.name)} paie<b>${eur(tot - a)} · ${pct(tot ? 1 - a / tot : .5)}</b></div></div></div>
    <p class="lbl" style="margin-top:12px">Choisis pour chaque ligne : 50/50, un pourcentage libre, ou équitable selon les salaires (${esc(A.name)} ${pct(totalSalary() ? A.salary / totalSalary() : .5)} · ${esc(B.name)} ${pct(totalSalary() ? B.salary / totalSalary() : .5)}). Tout se recalcule automatiquement.</p>
    ${section('common', 'fixed')}${section('common', 'envelope')}${section('common', 'savings')}`;
}

function viewDebts() {
  const st = settlement();
  const [A, B] = state.members;
  const a = st.bal[A.id];
  const verdict = !st.any ? '<div class="notice">Rien à décompter pour ce mois-ci.</div>'
    : Math.abs(a) < 0.01 ? '<div class="notice ok">Tout est équilibré 🎉</div>'
    : `<div class="big">${esc((a < 0 ? A : B).name)} doit<br>${eur(Math.abs(a))}<br><span class="lbl">à ${esc((a < 0 ? B : A).name)}</span></div>`;
  return `<div class="card">${verdict}
    <div class="acts" style="margin-top:12px"><button class="btn sm" data-act="settle">Noter un remboursement</button></div>
    <p class="lbl" style="margin-top:10px">Pour chaque dépense commune, la part de chacun suit la répartition choisie (50/50, pourcentage ou selon les salaires). Les charges fixes communes comptent chaque mois si tu indiques qui les paie habituellement.</p></div>
    <div class="grid g2" style="margin-top:12px">${state.members.map(m => `<div class="card"><div class="who">${colorDot(m.color)}${esc(m.name)}</div>
      <div class="line"><span>A payé</span><b>${eur(st.paid[m.id])}</b></div>
      <div class="line"><span>Sa part à charge</span><b>${eur(st.due[m.id])}</b></div>
      <div class="line"><span>Remboursements</span><b>${eur(st.bal[m.id] - (st.paid[m.id] - st.due[m.id]))}</b></div>
      <div class="line total"><span>Solde</span>${signed(st.bal[m.id])}</div></div>`).join('')}</div>
    <div class="sec-head"><div><h2>Dépenses payées</h2><span class="sum">${st.rows.length} ce mois-ci</span></div></div>
    ${st.rows.length ? `<div class="card">${st.rows.sort((x, y) => y.date.localeCompare(x.date)).map(r => `<div class="line"><span>${esc(r.it.icon)} <b>${esc(r.note && r.note !== 'Chaque mois' ? r.note : r.it.name)}</b><small class="lbl" style="display:block">${r.date ? new Date(r.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) + ' · ' : ''}${esc(r.it.name)} · payé par ${esc(memberById(r.payer).name)} · ${splitLabel(r.it)}</small></span>
      <span style="text-align:right"><b>${eur(r.amount)}</b>${r.txId ? ` <button data-act="deltx" data-id="${r.txId}" style="border:0;background:none;color:var(--bad)" aria-label="Supprimer">✕</button>` : ''}</span></div>`).join('')}</div>`
      : '<div class="empty">Ajoute une dépense avec le bouton + en indiquant qui a payé.</div>'}
    ${st.settles.length ? `<div class="sec-head"><h2>Remboursements</h2></div><div class="card">${st.settles.map(r => `<div class="line"><span>${esc(memberById(r.from).name)} → ${esc(memberById(r.to).name)}<small class="lbl" style="display:block">${new Date(r.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</small></span><span><b>${eur(r.amount)}</b> <button data-act="delsettle" data-id="${r.id}" style="border:0;background:none;color:var(--bad)" aria-label="Supprimer">✕</button></span></div>`).join('')}</div>` : ''}`;
}

function viewPers() {
  const m = memberById(ui.pers), s = memberSummary(m);
  return `<div class="seg">${state.members.map(x => `<button data-act="pers" data-id="${x.id}" class="${x.id === m.id ? 'on' : ''}">${esc(x.name)}</button>`).join('')}</div>
    <div class="card" style="margin-top:12px"><div class="lbl">Reste à vivre de ${esc(m.name)} · par mois</div><div class="big ${s.left < 0 ? 'neg' : ''}">${eur(s.left)}</div>
    <div class="mini-row"><div class="mini g">Salaire net<b>${eur(m.salary)}</b></div><div class="mini">Part commune<b>${eur(s.cFixed + s.cEnv + s.cSav)}</b></div><div class="mini p">Perso engagé<b>${eur(s.pFixed + s.pEnv + s.pSav)}</b></div></div></div>
    ${section(m.id, 'fixed')}${section(m.id, 'envelope')}${section(m.id, 'savings')}`;
}

function viewSettings() {
  return `<div class="grid g2">${state.members.map((m, i) => `<div class="card"><div class="who">${colorDot(m.color)}Membre ${i + 1}</div>
    <form data-form="member" data-id="${m.id}">
      <label>Prénom<input name="name" value="${esc(m.name)}" required></label>
      <label>Salaire net mensuel (€)<input name="salary" inputmode="decimal" value="${m.salary}"></label>
      <label>Couleur<input type="color" name="color" value="${m.color}" style="height:42px;padding:4px"></label>
      <div class="form-acts"><button class="btn sm">Enregistrer</button></div>
    </form></div>`).join('')}</div>
    <div class="card" style="margin-top:12px"><h2>Apparence</h2>
      <div class="seg" style="display:flex">${[['classic', 'Classique'], ['glass', 'Liquid Glass']].map(([k, l]) => `<button style="flex:1" data-act="theme" data-v="${k}" class="${prefs().theme === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <p class="lbl" style="margin:12px 0 6px">Mode</p>
      <div class="seg" style="display:flex">${[['light', 'Clair'], ['dark', 'Sombre'], ['auto', 'Automatique']].map(([k, l]) => `<button style="flex:1" data-act="mode" data-v="${k}" class="${prefs().mode === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    </div>
    <div class="card" style="margin-top:12px"><h2>Données</h2>
      <p class="lbl">Tout est enregistré dans ton navigateur. Exporte une sauvegarde pour la garder ou la transférer.</p>
      <div class="acts"><button class="btn soft sm" data-act="export">Exporter (JSON)</button>
      <label class="btn soft sm" style="flex-direction:row;cursor:pointer;text-transform:none;letter-spacing:0;color:inherit;font-size:13px">Importer<input type="file" id="imp" accept="application/json" hidden></label>
      <button class="btn danger sm" data-act="reset">Tout effacer</button>
      <button class="btn ghost sm" data-act="demo">Recharger l’exemple</button></div></div>`;
}

/* ---------- Modales ---------- */
const modal = $('#modal');
function openModal(html) { modal.innerHTML = html; if (!modal.open) modal.showModal(); }
function closeModal() { modal.close(); }

function openItem(scope, kind, id) {
  const it = id ? state.items.find(i => i.id === id) : { scope, kind, name: '', icon: KINDS[kind].icon, amount: '', split: { mode: 'half', pct: 50 } };
  const common = it.scope === 'common';
  const [A, B] = state.members;
  const amountLbl = it.kind === 'savings' ? 'Épargne mensuelle (€)' : it.kind === 'envelope' ? 'Budget mensuel (€)' : 'Montant mensuel (€)';
  openModal(`<h2>${id ? 'Modifier' : 'Ajouter'} · ${KINDS[it.kind].one}</h2>
  <form data-form="item" data-id="${id || ''}" data-scope="${it.scope}" data-kind="${it.kind}">
    <div class="row2" style="grid-template-columns:80px 1fr"><label>Icône<input name="icon" value="${esc(it.icon)}" maxlength="4" style="text-align:center;font-size:20px"></label>
    <label>Nom<input name="name" value="${esc(it.name)}" required placeholder="Ex : ${it.kind === 'fixed' ? 'Loyer' : it.kind === 'envelope' ? 'Courses' : 'Voyage'}"></label></div>
    <label>${amountLbl}<input name="amount" inputmode="decimal" value="${it.amount}" required></label>
    ${it.kind === 'savings' ? `<div class="row2"><label>Objectif (€)<input name="target" inputmode="decimal" value="${it.target || ''}"></label>
      <label>Déjà épargné (€)<input name="balance0" inputmode="decimal" value="${it.balance0 || ''}"></label></div>
      <label>Mois restants pour atteindre l’objectif<input name="months" inputmode="numeric" placeholder="Ex : 12"></label>
      <div class="sub" id="monthsHint">Modifie le nombre de mois : l’épargne mensuelle se recalcule (et inversement).</div>` : ''}
    ${common && it.kind === 'fixed' ? `<label>Payé chaque mois par<select name="payer"><option value="">Non suivi</option>${state.members.map(m => `<option value="${m.id}" ${it.payer === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></label>` : ''}
    ${common ? `<label>Répartition</label>
      <div class="modes">
        <label><input type="radio" name="mode" value="half" ${it.split.mode === 'half' ? 'checked' : ''}>50 / 50</label>
        <label><input type="radio" name="mode" value="percent" ${it.split.mode === 'percent' ? 'checked' : ''}>Pourcentage</label>
        <label><input type="radio" name="mode" value="salary" ${it.split.mode === 'salary' ? 'checked' : ''}>Selon salaires</label>
      </div>
      <label id="pctBox" ${it.split.mode === 'percent' ? '' : 'hidden'}><span id="pctLbl"></span><input type="range" name="pct" min="0" max="100" value="${it.split.pct}"></label>
      <div class="preview" id="preview"></div>` : ''}
    <div class="form-acts"><button type="button" class="btn soft" data-act="close">Annuler</button><button class="btn">Enregistrer</button></div>
  </form>`);
  if (common) updatePreview();
  if (it.kind === 'savings') syncSavings('amount', id);
}

/** Lie épargne mensuelle, objectif, déjà épargné et mois restants. */
function syncSavings(src, id) {
  const f = $('form[data-form="item"]');
  if (!f || !f.months) return;
  const itemId = id ?? f.dataset.id;
  const txSum = itemId ? state.txs.filter(t => t.itemId === itemId).reduce((a, t) => a + t.amount, 0) : 0;
  const rest = Math.max(num(f.target.value) - num(f.balance0.value) - txSum, 0);
  if (src === 'months') {
    const m = Math.floor(num(f.months.value));
    if (m > 0 && rest > 0) { f.amount.value = (Math.ceil(rest / m * 100) / 100).toString().replace('.', ','); updatePreview(); }
  } else {
    const a = num(f.amount.value);
    f.months.value = rest > 0 && a > 0 ? Math.ceil(rest / a) : '';
  }
  $('#monthsHint').textContent = !num(f.target.value) ? 'Indique un objectif pour calculer la durée.' : rest === 0 ? 'Objectif atteint 🎉' : `Reste à épargner : ${eur(rest)}`;
}

function updatePreview() {
  const f = $('form[data-form="item"]');
  if (!f || !$('#preview')) return;
  const amount = num(f.amount.value);
  const mode = f.mode.value;
  $('#pctBox').hidden = mode !== 'percent';
  const tmp = { scope: 'common', split: { mode, pct: +f.pct.value } };
  const [A, B] = state.members;
  $('#pctLbl').textContent = `${A.name} ${f.pct.value}% · ${B.name} ${100 - f.pct.value}%`;
  $('#preview').innerHTML = state.members.map(m => `${esc(m.name)} : <b>${eur(amount * share(tmp, m.id))}</b> (${pct(share(tmp, m.id))})`).join(' &nbsp;·&nbsp; ');
}

function openSettle() {
  const st = settlement();
  const [A, B] = state.members;
  const debtor = st.bal[A.id] < 0 ? A : B, creditor = debtor === A ? B : A;
  const today = new Date().toISOString().slice(0, 10);
  const date = today.startsWith(ui.month) ? today : ui.month + '-01';
  const amt = Math.abs(st.bal[A.id]) > 0.005 ? Math.abs(st.bal[A.id]).toFixed(2) : '';
  const opts = sel => state.members.map(m => `<option value="${m.id}" ${m === sel ? 'selected' : ''}>${esc(m.name)}</option>`).join('');
  openModal(`<h2>Noter un remboursement</h2>
  <form data-form="settle">
    <input class="amount-in" name="amount" inputmode="decimal" value="${amt}" placeholder="0,00 €" required>
    <div class="row2"><label>De<select name="from">${opts(debtor)}</select></label><label>Vers<select name="to">${opts(creditor)}</select></label></div>
    <label>Date<input type="date" name="date" value="${date}" required></label>
    <div class="form-acts"><button type="button" class="btn soft" data-act="close">Annuler</button><button class="btn">Enregistrer</button></div>
  </form>`);
}

function openTx(itemId) {
  const it = itemId && state.items.find(i => i.id === itemId);
  const choices = state.items.filter(i => i.kind !== 'fixed' && (i.scope === 'common' || i.scope === ui.pers || ui.view !== 'pers'));
  const today = new Date().toISOString().slice(0, 10);
  const date = today.startsWith(ui.month) ? today : ui.month + '-01';
  const lbl = it && it.kind === 'savings' ? 'Versement' : 'Dépense';
  const who = i => i.scope === 'common' ? 'Commun' : memberById(i.scope).name;
  openModal(`<h2>${it ? esc(it.icon) + ' ' + esc(it.name) + ' · ' + lbl : 'Nouvelle ligne'}</h2>
  <form data-form="tx" data-id="${itemId || ''}">
    <input class="amount-in" name="amount" inputmode="decimal" placeholder="0,00 €" required autofocus>
    ${it ? '' : `<label>Enveloppe<select name="itemSel">${choices.map(i => `<option value="${i.id}">${esc(i.icon)} ${esc(i.name)} · ${esc(who(i))}</option>`).join('')}</select></label>`}
    <div class="row2"><label>Date<input type="date" name="date" value="${date}" required></label>
    <label id="payerBox" ${it && it.scope !== 'common' ? 'hidden' : ''}>Payé par<select name="payer">${state.members.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select></label></div>
    <label>Note<input name="note" placeholder="Optionnel"></label>
    <div class="form-acts"><button type="button" class="btn soft" data-act="close">Annuler</button><button class="btn">Ajouter</button></div>
  </form>`);
  if (!it) syncPayer();
}
function syncPayer() {
  const f = $('form[data-form="tx"]');
  if (!f || !f.itemSel) return;
  const it = state.items.find(i => i.id === f.itemSel.value);
  $('#payerBox').hidden = !it || it.scope !== 'common';
}

/* ---------- Événements ---------- */
document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const d = b.dataset;
  switch (d.act) {
    case 'nav': ui.view = d.v; break;
    case 'pers': ui.pers = d.id; break;
    case 'theme': prefs().theme = d.v; break;
    case 'mode': prefs().mode = d.v; break;
    case 'quick': return openTx();
    case 'settle': return openSettle();
    case 'delsettle': state.settles = state.settles.filter(r => r.id !== d.id); break;
    case 'month-prev': case 'month-next': {
      const [y, m] = ui.month.split('-').map(Number);
      const dt = new Date(y, m - 1 + (d.act === 'month-next' ? 1 : -1), 1);
      ui.month = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`; break;
    }
    case 'add': return openItem(d.scope, d.kind);
    case 'edit': { const it = state.items.find(i => i.id === d.id); return openItem(it.scope, it.kind, it.id); }
    case 'tx': return openTx(d.id);
    case 'close': return closeModal();
    case 'del': {
      const it = state.items.find(i => i.id === d.id);
      if (!confirm(`Supprimer « ${it.name} » ?`)) return;
      state.items = state.items.filter(i => i.id !== d.id);
      state.txs = state.txs.filter(t => t.itemId !== d.id); break;
    }
    case 'deltx': state.txs = state.txs.filter(t => t.id !== d.id); break;
    case 'export': {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }));
      a.download = 'split-my-money.json'; a.click(); return;
    }
    case 'reset': if (!confirm('Effacer toutes les données ?')) return;
      state = { members: seed().members, items: [], txs: [] }; break;
    case 'demo': if (!confirm('Remplacer tes données par l’exemple ?')) return; state = seed(); break;
  }
  render();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => prefs().mode === 'auto' && render());
});

document.addEventListener('input', e => {
  if (!e.target.closest('form[data-form="item"]')) return;
  updatePreview();
  if (['amount', 'target', 'balance0', 'months'].includes(e.target.name)) syncSavings(e.target.name);
});
document.addEventListener('change', e => { if (e.target.name === 'itemSel') syncPayer(); });
document.addEventListener('change', e => {
  if (e.target.id === 'imp') {
    const r = new FileReader();
    r.onload = () => {
      try { const s = JSON.parse(r.result); if (!s.members || !s.items) throw 0; state = migrate({ txs: [], ...s }); render(); }
      catch (err) { alert('Fichier invalide.'); }
    };
    r.readAsText(e.target.files[0]);
  }
});

document.addEventListener('submit', e => {
  const f = e.target.closest('form[data-form]');
  if (!f) return;
  e.preventDefault();
  const v = f.elements, d = f.dataset;
  if (d.form === 'member') {
    const m = memberById(d.id);
    Object.assign(m, { name: v.name.value.trim() || m.name, salary: num(v.salary.value), color: v.color.value });
  } else if (d.form === 'item') {
    const data = { icon: v.icon.value || '•', name: v.name.value.trim(), amount: num(v.amount.value) };
    if (d.kind === 'savings') Object.assign(data, { target: num(v.target.value), balance0: num(v.balance0.value) });
    if (v.payer) data.payer = v.payer.value;
    if (d.scope === 'common') data.split = { mode: v.mode.value, pct: +v.pct.value };
    if (d.id) Object.assign(state.items.find(i => i.id === d.id), data);
    else state.items.push({ id: uid(), scope: d.scope, kind: d.kind, ...data });
  } else if (d.form === 'settle') {
    const amount = num(v.amount.value);
    if (!amount || v.from.value === v.to.value) return;
    (state.settles = state.settles || []).push({ id: uid(), amount, from: v.from.value, to: v.to.value, date: v.date.value });
  } else if (d.form === 'tx') {
    const amount = num(v.amount.value);
    if (!amount) return;
    const itemId = d.id || v.itemSel.value;
    const target = state.items.find(i => i.id === itemId);
    state.txs.push({ id: uid(), itemId, amount, date: v.date.value, note: v.note.value.trim(), payer: target.scope === 'common' ? v.payer.value : null });
    if (!v.date.value.startsWith(ui.month)) ui.month = v.date.value.slice(0, 7);
  }
  if (modal.open) closeModal();
  render();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => prefs().mode === 'auto' && render());
});

render();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => prefs().mode === 'auto' && render());

/* Appli installable : le service worker se met à jour tout seul, sans réinstaller le raccourci. */
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').then(reg => {
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
  }).catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) location.reload(); });
}

/* iOS ignore user-scalable=no : on bloque aussi le pincement. */
['gesturestart', 'gesturechange', 'gestureend'].forEach(t => document.addEventListener(t, e => e.preventDefault()));
document.addEventListener('touchmove', e => { if (e.touches.length > 1 || (e.scale && e.scale !== 1)) e.preventDefault(); }, { passive: false });
document.addEventListener('touchstart', e => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
