// Frontend vanilla (tanpa build, tanpa CDN). Semua teks dari server dimasukkan lewat textContent.
const $ = (sel) => document.querySelector(sel);
const state = { user: null, tab: null, jobId: null, es: null, sysTimer: null, shells: [] };
const TABS = [
  { id: 'sistem', label: 'Sistem', admin: false },
  { id: 'terminal', label: 'Terminal', admin: true },
  { id: 'pengguna', label: 'Pengguna', admin: true },
  { id: 'akun', label: 'Akun', admin: false },
];

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch { /* bukan JSON */ }
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function el(tag, text, cls) {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  if (cls) n.className = cls;
  return n;
}

function notice(msg, isError = false) {
  const n = $('#notice');
  n.textContent = msg;
  n.className = 'notice' + (isError ? ' error' : '');
  clearTimeout(notice.t);
  notice.t = setTimeout(() => n.classList.add('hidden'), 8000);
}

const fmtBytes = (b) => {
  if (b == null) return '-';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0; let v = b;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i ? 1 : 0)} ${units[i]}`;
};
const fmtUptime = (s) => `${Math.floor(s / 3600)} jam ${Math.floor((s % 3600) / 60)} menit`;

// ---------- Login ----------
$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  $('#loginError').textContent = '';
  try {
    const { user } = await api('POST', '/api/login', { username: f.get('username'), password: f.get('password') });
    state.user = user;
    e.target.reset();
    enterApp();
  } catch (err) {
    $('#loginError').textContent = err.message;
  }
});

$('#logoutBtn').addEventListener('click', async () => {
  await api('POST', '/api/logout').catch(() => {});
  location.reload();
});

function showLogin() {
  $('#app').classList.add('hidden');
  $('#login').classList.remove('hidden');
}

function enterApp() {
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#who').textContent = `${state.user.username} (${state.user.role})`;
  const isAdmin = state.user.role === 'admin';
  const nav = $('#nav');
  nav.textContent = '';
  for (const t of TABS) {
    if (t.admin && !isAdmin) continue;
    const b = el('button', t.label);
    b.dataset.tab = t.id;
    b.addEventListener('click', () => showTab(t.id));
    nav.append(b);
  }
  if (state.user.mustChangePassword) {
    notice('Kamu wajib mengganti sandi sebelum melanjutkan.', true);
    return showTab('akun');
  }
  showTab('sistem');
}

function showTab(id) {
  state.tab = id;
  for (const s of document.querySelectorAll('.tab')) s.classList.add('hidden');
  $(`#tab-${id}`).classList.remove('hidden');
  for (const b of document.querySelectorAll('nav button')) b.classList.toggle('active', b.dataset.tab === id);
  clearInterval(state.sysTimer);
  if (id === 'sistem') { loadSystem(); state.sysTimer = setInterval(loadSystem, 5000); }
  if (id === 'terminal') loadJobs();
  if (id === 'pengguna') loadUsers();
}

// ---------- Sistem ----------
async function loadSystem() {
  try {
    const s = await api('GET', '/api/system');
    const rows = [
      ['Host', s.hostname],
      ['OS', `${s.platform} ${s.release} (${s.arch})`],
      ['Node.js', s.node],
      ['CPU', `${s.cpu.model} · ${s.cpu.cores} core`],
      ['Load rata-rata', s.platform === 'win32' ? 'tidak tersedia di Windows' : s.cpu.loadavg.map((x) => x.toFixed(2)).join(' / ')],
      ['RAM', `${fmtBytes(s.memory.totalBytes - s.memory.freeBytes)} terpakai dari ${fmtBytes(s.memory.totalBytes)}`],
      ['Disk', s.disk ? `${fmtBytes(s.disk.freeBytes)} kosong dari ${fmtBytes(s.disk.totalBytes)}` : 'tidak terbaca'],
      ['Uptime', fmtUptime(s.uptimeSec)],
      ['Shell default', s.defaultShell],
      ['Folder default', s.defaultCwd],
    ];
    const t = $('#sysTable');
    t.textContent = '';
    for (const [k, v] of rows) {
      const tr = el('tr');
      tr.append(el('th', k), el('td', String(v)));
      t.append(tr);
    }
    if (!state.shells.length) {
      state.shells = s.shells;
      const sel = $('#shellSelect');
      sel.textContent = '';
      for (const sh of s.shells) {
        const o = el('option', sh);
        o.value = sh;
        if (sh === s.defaultShell) o.selected = true;
        sel.append(o);
      }
    }
  } catch (err) {
    if (err.status === 401) showLogin();
  }
}

// ---------- Terminal ----------
$('#jobForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const body = {
    command: f.get('command'),
    shell: f.get('shell'),
    cwd: f.get('cwd') || undefined,
    timeoutSec: Number(f.get('timeoutSec')) || undefined,
  };
  try {
    const { job } = await api('POST', '/api/jobs', body);
    e.target.command.value = '';
    await loadJobs();
    openJob(job.id);
  } catch (err) {
    notice(err.message, true);
  }
});

async function loadJobs() {
  try {
    const { jobs } = await api('GET', '/api/jobs');
    const ul = $('#jobList');
    ul.textContent = '';
    for (const j of jobs) {
      const li = el('li', undefined, j.id === state.jobId ? 'sel' : '');
      const head = el('div');
      head.append(el('span', j.status, `badge ${j.status}`), document.createTextNode(' '), el('small', new Date(j.startedAt).toLocaleString(), 'muted'));
      li.append(head, el('code', j.command));
      li.addEventListener('click', () => openJob(j.id));
      ul.append(li);
    }
    updateStopButton(jobs);
  } catch (err) {
    if (err.status === 401) showLogin();
  }
}

function updateStopButton(jobs) {
  const running = jobs.find((j) => j.id === state.jobId && j.status === 'running');
  $('#stopBtn').classList.toggle('hidden', !running);
}

function openJob(id) {
  if (state.es) state.es.close();
  state.jobId = id;
  const out = $('#output');
  out.textContent = '';
  const es = new EventSource(`/api/jobs/${id}/stream`);
  state.es = es;
  es.onmessage = (msg) => {
    const ev = JSON.parse(msg.data);
    if (ev.type === 'snapshot') out.textContent = ev.output || '';
    if (ev.type === 'data') out.textContent += ev.text;
    if (ev.type === 'end') {
      out.textContent += `\n\n[selesai: ${ev.status}${ev.exitCode != null ? `, kode ${ev.exitCode}` : ''}]`;
      es.close();
      state.es = null;
      loadJobs();
    }
    out.scrollTop = out.scrollHeight;
  };
  es.onerror = () => { es.close(); state.es = null; };
  $('#jobMeta').textContent = `· ${id.slice(0, 8)}`;
  loadJobs();
}

$('#stopBtn').addEventListener('click', async () => {
  if (!state.jobId) return;
  try {
    await api('POST', `/api/jobs/${state.jobId}/stop`);
  } catch (err) {
    notice(err.message, true);
  }
});

// ---------- Pengguna ----------
$('#userForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  try {
    const { password, user } = await api('POST', '/api/users', {
      username: f.get('username'),
      password: f.get('password') || undefined,
      role: f.get('role'),
    });
    e.target.reset();
    notice(password ? `Akun ${user.username} dibuat. Sandi sementara: ${password}` : `Akun ${user.username} dibuat.`);
    loadUsers();
  } catch (err) {
    notice(err.message, true);
  }
});

async function loadUsers() {
  try {
    const { users } = await api('GET', '/api/users');
    const t = $('#userTable');
    t.textContent = '';
    const head = el('tr');
    ['Username', 'Role', 'Status', 'Aksi'].forEach((h) => head.append(el('th', h)));
    t.append(head);
    for (const u of users) {
      const tr = el('tr');
      tr.append(el('td', u.username), el('td', u.role), el('td', u.disabled ? 'nonaktif' : 'aktif'));
      const td = el('td');
      const mk = (label, fn) => {
        const b = el('button', label, 'small ghost');
        b.addEventListener('click', fn);
        return b;
      };
      td.append(
        mk(u.disabled ? 'Aktifkan' : 'Nonaktifkan', () => toggleUser(u)),
        document.createTextNode(' '),
        mk('Reset sandi', () => resetUser(u)),
      );
      tr.append(td);
      t.append(tr);
    }
  } catch (err) {
    notice(err.message, true);
  }
}

async function toggleUser(u) {
  try {
    await api('POST', `/api/users/${u.id}/disable`, { disabled: !u.disabled });
    loadUsers();
  } catch (err) { notice(err.message, true); }
}

async function resetUser(u) {
  if (!confirm(`Reset sandi ${u.username}? Sesi login-nya akan diputus.`)) return;
  try {
    const { password } = await api('POST', `/api/users/${u.id}/reset`, {});
    notice(`Sandi ${u.username} direset. Sandi sementara: ${password}`);
  } catch (err) { notice(err.message, true); }
}

// ---------- Akun ----------
$('#pwForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  try {
    await api('POST', '/api/password', { old: f.get('old'), new: f.get('new') });
    e.target.reset();
    state.user.mustChangePassword = false;
    notice('Sandi berhasil diganti.');
    enterApp();
  } catch (err) { notice(err.message, true); }
});

// ---------- Boot ----------
(async function boot() {
  try {
    const { user } = await api('GET', '/api/me');
    state.user = user;
    enterApp();
  } catch {
    showLogin();
  }
})();
