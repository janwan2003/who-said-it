const form = document.getElementById('create');
const errEl = document.getElementById('err');
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errEl.textContent = '';
  const btn = form.querySelector('button');
  btn.disabled = true;
  btn.textContent = 'Creating…';
  try {
    const r = await PN.api('groups', {
      method: 'POST',
      body: { name: document.getElementById('gname').value, nickname: document.getElementById('nick').value, tz: PN.tz() },
    });
    PN.store.set(r.id, r.token);
    location.href = '/g/' + r.id + '?new=1';
  } catch (ex) {
    errEl.textContent = ex.message;
    btn.disabled = false;
    btn.textContent = 'Create group and get the link';
  }
});
