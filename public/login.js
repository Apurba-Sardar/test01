const $ = (s) => document.querySelector(s);
const ICONS = {
  sun: '<svg class="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  moon: '<svg class="i" viewBox="0 0 24 24"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
};
function isDark() {
  const t = document.documentElement.dataset.theme;
  return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
}
function paintThemeBtn() { $('#themeBtn').innerHTML = isDark() ? ICONS.sun : ICONS.moon; }
$('#themeBtn').addEventListener('click', () => {
  const next = isDark() ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('theme', next); } catch {}
  paintThemeBtn();
});
paintThemeBtn();

$('#reveal').addEventListener('click', () => {
  const p = $('#password');
  p.type = p.type === 'password' ? 'text' : 'password';
  $('#reveal').setAttribute('aria-label', p.type === 'password' ? 'Show password' : 'Hide password');
  p.focus();
});

function showError(msg) {
  $('#alertText').textContent = msg;
  $('#alert').classList.add('show');
}

$('#form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = $('#username').value.trim();
  const password = $('#password').value;
  if (!username || !password) return showError('Please enter your username and password.');
  const btn = $('#submit');
  btn.disabled = true;
  btn.textContent = 'Signing in…';
  $('#alert').classList.remove('show');
  try {
    const r = await fetch('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password, remember: $('#remember').checked }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Sign-in failed.');
    const next = new URLSearchParams(location.search).get('next') || '/';
    location.href = next.startsWith('/') && !next.startsWith('//') ? next : '/';
  } catch (err) {
    showError(err.message === 'Failed to fetch' ? 'Cannot reach the server. Check your connection.' : err.message);
    $('#password').select();
    btn.disabled = false;
    btn.textContent = 'Sign in';
  }
});
