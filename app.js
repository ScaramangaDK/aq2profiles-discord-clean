// app.js — Phase 2 (Supabase + Discord Auth + CRUD + Storage)
(function () {
  'use strict';

  // ====== CONFIG ======
  // Your Supabase project URL and anon key
  const SUPABASE_URL = 'https://kkragzcfhsxajoorsqhs.supabase.co';
  const SUPABASE_ANON =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtrcmFnemNmaHN4YWpvb3JzcWhzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUwOTQ4MzEsImV4cCI6MjA3MDY3MDgzMX0.5ca3Hl_I2FfnwSQc7DrMprrxMtvIIC2Inhl4nJt6hu0';

  // Storage buckets
  const BUCKET_PICS = 'profile-pics';
  const BUCKET_PAKS = 'player-paks';
  const BUCKET_SITE = 'site-assets';

  // Admin who can edit everything (UUID from auth.users)
  // If you don’t want an admin override, set to empty string ''.
  const ADMIN_UID = '920549c3-d37c-40e5-9e6d-221299f373c1';

  // Size limits
  const MAX_IMG_BYTES = 5 * 1024 * 1024; // 5 MB
  const MAX_CFG_BYTES = 200 * 1024; // 200 KB
  const MAX_PAK_BYTES = 50 * 1024 * 1024; // 50 MB

  // Supabase client (global)
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

  // ====== UTIL ======
  const $ = (id) => document.getElementById(id);
  const escapeHtml = (s) =>
    String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const calcEdpi = (dpi, sens) => {
    const d = Number(dpi) || 0;
    const s = Number(sens) || 0;
    return d && s ? Math.round(d * s) : '';
  };

  // ====== HEADER LOGO ======
  // Loads site-assets/header.png to <img id="logoImg">
  async function loadHeaderLogo() {
    try {
      const el = $('logoImg');
      if (!el || !window.supabase) return;

      const { data } = window.supabase.storage.from(BUCKET_SITE).getPublicUrl('header.png');
      if (!data?.publicUrl) {
        console.warn('Logo public URL not available');
        el.alt = 'Logo';
        return;
      }
      // cache-buster so a new upload shows without hard refresh
      el.src = `${data.publicUrl}?v=${Date.now()}`;
      el.alt = 'Logo';
    } catch (e) {
      console.warn('Failed to load logo', e);
    }
  }

  // ====== AUTH UI ======
  async function refreshSessionUI() {
    const {
      data: { user },
    } = await sb.auth.getUser();

    const logoutBtn = $('logoutBtn');
    const loginBtn = $('loginBtn'); // single login button used for Discord OAuth
    const emailInput = $('emailInput'); // hide if present
    const roleInd = $('roleIndicator');

    if (user) {
      if (logoutBtn) logoutBtn.style.display = '';
      if (loginBtn) loginBtn.style.display = 'none';
      if (emailInput) emailInput.style.display = 'none';
      if (roleInd) roleInd.textContent = `Signed in as ${user.email ?? 'Discord user'}`;
      const addBtn = $('addBtn');
      if (addBtn) addBtn.disabled = false;
    } else {
      if (logoutBtn) logoutBtn.style.display = 'none';
      if (loginBtn) loginBtn.style.display = '';
      if (emailInput) emailInput.style.display = 'none';
      if (roleInd) roleInd.textContent = '';
      const addBtn = $('addBtn');
      if (addBtn) addBtn.disabled = true;
    }
  }

  // Discord OAuth
  const loginBtn = $('loginBtn');
  if (loginBtn) {
    loginBtn.addEventListener('click', async () => {
      try {
        await sb.auth.signInWithOAuth({
          provider: 'discord',
          options: {
            redirectTo: window.location.origin, // back to site
          },
        });
      } catch (e) {
        alert('Login failed: ' + (e?.message || e));
      }
    });
  }

  const logoutBtn = $('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      await sb.auth.signOut();
    });
  }

  sb.auth.onAuthStateChange((_event, _session) => {
    refreshSessionUI();
    loadProfiles();
  });

  // ====== DATA (PROFILES) ======
  async function loadProfiles() {
    const tbody = $('profilesBody');
    if (!tbody) return;
    tbody.innerHTML =
      '<tr><td colspan="12" style="text-align:center;color:var(--muted);padding:24px">Loading…</td></tr>';

    const { data, error } = await sb.from('profiles').select('*').order('created_at', { ascending: false });

    if (error) {
      tbody.innerHTML = `<tr><td colspan="12" class="muted" style="text-align:center;padding:24px">${escapeHtml(
        error.message
      )}</td></tr>`;
      return;
    }

    const term = ($('searchBar')?.value || '').toLowerCase();

    const rows = (data || []).filter((p) => {
      const t = [
        p.nickname,
        p.screen_hz,
        p.headphones,
        p.mouse,
        p.keyboard,
        p.dpi,
        p.sens,
        p.zoom,
        p.cfg_name || '',
        p.pak_name || '',
      ]
        .join(' ')
        .toLowerCase();
      return !term || t.includes(term);
    });

    if (!rows.length) {
      tbody.innerHTML =
        '<tr><td colspan="12" class="muted" style="text-align:center;padding:24px">No matches.</td></tr>';
      return;
    }

    const {
      data: { user },
    } = await sb.auth.getUser();

    tbody.innerHTML = rows
      .map((p) => {
        const mine = user && (p.owner === user.id || (ADMIN_UID && user.id === ADMIN_UID));
        const cfgCell = p.cfg_text
          ? `<button class="secondary" data-action="viewcfg" data-id="${p.id}">View CFG</button>`
          : '<span class="muted">—</span>';
        const pakCell = p.pak_url
          ? `<a class="secondary" href="${escapeHtml(p.pak_url)}" download>Download</a>`
          : '<span class="muted">—</span>';
        const actions = mine
          ? `<button class="secondary" data-action="edit" data-id="${p.id}">Edit</button> 
             <button class="warn" data-action="delete" data-id="${p.id}">Delete</button>`
          : '<span class="muted">—</span>';

        return `
        <tr>
          <td><a class="nick" data-id="${p.id}">${escapeHtml(p.nickname || '')}</a></td>
          <td>${escapeHtml(p.screen_hz || '')}</td>
          <td>${escapeHtml(p.headphones || '')}</td>
          <td>${escapeHtml(p.mouse || '')}</td>
          <td>${escapeHtml(p.keyboard || '')}</td>
          <td class="num">${p.dpi || ''}</td>
          <td class="num">${p.sens || ''}</td>
          <td class="num">${calcEdpi(p.dpi, p.sens)}</td>
          <td class="center narrow">${p.zoom || ''}</td>
          <td>${cfgCell}</td>
          <td>${pakCell}</td>
          <td style="text-align:right">${actions}</td>
        </tr>`;
      })
      .join('');
  }

  $('searchBar')?.addEventListener('input', loadProfiles);

  // Delegated table actions
  $('profilesBody')?.addEventListener('click', async (e) => {
    const a = e.target.closest('a.nick');
    if (a) {
      openPlayer(a.getAttribute('data-id'));
      return;
    }
    const btn = e.target.closest('button');
    if (!btn) return;
    const id = btn.getAttribute('data-id');
    const action = btn.getAttribute('data-action');

    if (action === 'viewcfg') {
      const { data, error } = await sb.from('profiles').select('cfg_text').eq('id', id).single();
      if (error) alert(error.message);
      else alert(data.cfg_text || 'No CFG uploaded.');
    } else if (action === 'edit') {
      openEdit(id);
    } else if (action === 'delete') {
      if (confirm('Delete this profile?')) {
        const { error } = await sb.from('profiles').delete().eq('id', id);
        if (error) alert(error.message);
        else loadProfiles();
      }
    }
  });

  async function openPlayer(id) {
    const { data: p, error } = await sb.from('profiles').select('*').eq('id', id).single();
    if (error || !p) return;

    $('m_name').textContent = p.nickname || '';
    $('m_name_inline').textContent = p.nickname || '';
    $('m_country').textContent = p.country || '';
    $('m_clan').textContent = p.clan || '';
    $('m_map').textContent = p.favorite_map || '';
    $('m_about').textContent = p.about || '';

    const img = $('m_pic');
    if (p.pic_url) {
      img.src = p.pic_url;
      img.style.objectFit = 'cover';
      img.removeAttribute('width');
      img.removeAttribute('height');
    } else {
      const ph =
        '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300">' +
        '<rect width="100%" height="100%" fill="#0e1220" />' +
        '<rect x="0.5" y="0.5" width="299" height="299" fill="none" stroke="#2a2f3d" />' +
        '<text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#9ca3af" font-size="16" font-family="Arial, Helvetica, sans-serif">No picture available</text>' +
        '</svg>';
      img.src = 'data:image/svg+xml;utf8,' + encodeURIComponent(ph);
      img.style.objectFit = 'contain';
      img.width = 240;
      img.height = 240;
    }
    $('playerModal').classList.add('open');
  }
  $('closePlayer')?.addEventListener('click', () => $('playerModal').classList.remove('open'));

  // ====== ADD / EDIT ======
  $('addBtn')?.addEventListener('click', async () => {
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (!user) {
      alert('Sign in to add a profile.');
      return;
    }
    openEdit(null);
  });

  $('cancelEdit')?.addEventListener('click', () => $('editModal').classList.remove('open'));

  function openEdit(id) {
    $('editTitle').textContent = id ? 'Edit Player' : 'Add Player';
    $('e_id').value = id || '';

    // clear
    $('e_nick').value = '';
    ['screen', 'head', 'mouse', 'keyboard', 'dpi', 'sens', 'zoom', 'country', 'clan', 'map', 'about'].forEach(
      (k) => ($('e_' + k).value = '')
    );
    $('e_pic').value = '';
    $('e_cfg').value = '';
    $('e_pak').value = '';

    if (id) {
      sb
        .from('profiles')
        .select('*')
        .eq('id', id)
        .single()
        .then(({ data: p, error }) => {
          if (error || !p) return alert(error?.message || 'Not found');
          $('e_nick').value = p.nickname || '';
          $('e_screen').value = p.screen_hz || '';
          $('e_head').value = p.headphones || '';
          $('e_mouse').value = p.mouse || '';
          $('e_keyboard').value = p.keyboard || '';
          $('e_dpi').value = p.dpi || '';
          $('e_sens').value = p.sens || '';
          $('e_zoom').value = p.zoom || '';
          $('e_country').value = p.country || '';
          $('e_clan').value = p.clan || '';
          $('e_map').value = p.favorite_map || '';
          $('e_about').value = p.about || '';
        });
    }
    $('editModal').classList.add('open');
  }

  // Remove buttons
  $('btnRemovePic')?.addEventListener('click', async () => {
    const id = $('e_id').value;
    if (!id) return alert('Open an existing profile to remove its pic.');
    const { error } = await sb.from('profiles').update({ pic_url: null }).eq('id', id);
    if (error) alert(error.message);
    else {
      alert('Profile picture removed.');
      loadProfiles();
    }
  });

  $('btnRemoveCfg')?.addEventListener('click', async () => {
    const id = $('e_id').value;
    if (!id) return alert('Open an existing profile to remove its CFG.');
    const { error } = await sb.from('profiles').update({ cfg_text: null, cfg_name: null }).eq('id', id);
    if (error) alert(error.message);
    else {
      alert('CFG removed.');
      loadProfiles();
    }
  });

  $('btnRemovePak')?.addEventListener('click', async () => {
    const id = $('e_id').value;
    if (!id) return alert('Open an existing profile to remove its pak.');
    const { error } = await sb.from('profiles').update({ pak_url: null, pak_name: null }).eq('id', id);
    if (error) alert(error.message);
    else {
      alert('Pak removed.');
      loadProfiles();
    }
  });

  // File readers / limits
  async function readCfg(file) {
    if (!file) return { name: null, text: null };
    if (file.size > MAX_CFG_BYTES) throw new Error('CFG too large (max 200KB).');
    const text = await file.text();
    // quick binary check
    for (let i = 0; i < Math.min(64, text.length); i++) {
      if (text.charCodeAt(i) === 0) throw new Error('Only text-based .cfg allowed');
    }
    return { name: file.name, text };
  }

  // Save
  $('editForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (!user) {
      alert('Sign in to save.');
      return;
    }

    const id = $('e_id').value || null;
    const rec = {
      owner: user.id,
      nickname: $('e_nick').value.trim(),
      screen_hz: $('e_screen').value.trim(),
      headphones: $('e_head').value.trim(),
      mouse: $('e_mouse').value.trim(),
      keyboard: $('e_keyboard').value.trim(),
      dpi: Number($('e_dpi').value) || null,
      sens: Number($('e_sens').value) || null,
      zoom: Number($('e_zoom').value) || null,
      country: $('e_country').value.trim(),
      clan: $('e_clan').value.trim(),
      favorite_map: $('e_map').value.trim(),
      about: $('e_about').value.slice(0, 1000),
    };

    if (!rec.nickname) {
      alert('Nickname required');
      return;
    }

    // files
    const picFile = $('e_pic').files[0] || null;
    const cfgFile = $('e_cfg').files[0] || null;
    const pakFile = $('e_pak').files[0] || null;

    try {
      // upsert row first (for new id)
      let rowId = id;
      if (!rowId) {
        const { data, error } = await sb.from('profiles').insert(rec).select('id').single();
        if (error) throw error;
        rowId = data.id;
      } else {
        const { error } = await sb.from('profiles').update(rec).eq('id', rowId);
        if (error) throw error;
      }

      // CFG
      if (cfgFile) {
        const { name, text } = await readCfg(cfgFile);
        const { error } = await sb.from('profiles').update({ cfg_name: name, cfg_text: text }).eq('id', rowId);
        if (error) throw error;
      }

      // PAK upload
      if (pakFile) {
        if (pakFile.size > MAX_PAK_BYTES) throw new Error('Pak too large (max 50MB).');
        const ext = (pakFile.name.split('.').pop() || 'zip').toLowerCase();
        const path = `${user.id}/${rowId}.${Date.now()}.${ext}`;
        const { error: upErr } = await sb.storage
          .from(BUCKET_PAKS)
          .upload(path, pakFile, { upsert: true, contentType: pakFile.type || 'application/octet-stream' });
        if (upErr) throw upErr;
        const { data: pub } = sb.storage.from(BUCKET_PAKS).getPublicUrl(path);
        const { error: updErr } = await sb
          .from('profiles')
          .update({ pak_url: pub.publicUrl, pak_name: pakFile.name })
          .eq('id', rowId);
        if (updErr) throw updErr;
      }

      // Picture upload
      if (picFile) {
        if (picFile.size > MAX_IMG_BYTES) throw new Error('Image too large (max 5MB).');
        const ext = (picFile.name.split('.').pop() || 'jpg').toLowerCase();
        const path = `${user.id}/${rowId}.${Date.now()}.${ext}`;
        const { error: upErr } = await sb.storage
          .from(BUCKET_PICS)
          .upload(path, picFile, { upsert: true, contentType: picFile.type || 'image/*' });
        if (upErr) throw upErr;
        const { data: pub } = sb.storage.from(BUCKET_PICS).getPublicUrl(path);
        const { error: updErr } = await sb.from('profiles').update({ pic_url: pub.publicUrl }).eq('id', rowId);
        if (updErr) throw updErr;
      }

      $('editModal').classList.remove('open');
      e.target.reset();
      loadProfiles();
    } catch (err) {
      // Friendly duplicate message
      const msg = String(err?.message || err);
      if (msg.includes('profiles_owner_nickname_unique') || msg.includes('duplicate key')) {
        alert('You already have a player with that nickname. Try another.');
      } else {
        alert(msg);
      }
    }
  });

  // ====== INIT ======
  (async function init() {
    // Make sure Add button starts disabled if not signed in
    const addBtn = $('addBtn');
    if (addBtn) addBtn.disabled = true;

    await refreshSessionUI();
    await loadProfiles();
    await loadHeaderLogo();
  })();
})();
