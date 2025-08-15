// app.js — Discord OAuth + Supabase (profiles CRUD, picture/CFG/pak uploads, site logo)
// ------------------------------------------------------------------------------------
(function () {
  'use strict';

  // ====== CONFIG ======
  // Use your Supabase project URL and anon key
  const SUPABASE_URL = 'https://wdmpgeegzbzaafhwjqaz.supabase.co';
  const SUPABASE_ANON =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndkbXBnZWVnemJ6YWFmaHdqcWF6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUxNjU3NDMsImV4cCI6MjA3MDc0MTc0M30.mNcriLvMZJ6jWUutuMiXrA4PNrvmV1JmzIgxkGP3d0U';

  // Storage buckets
  const PIC_BUCKET = 'profile-pics';
  const PAK_BUCKET = 'player-paks';
  // Optional: master admin UUID (can edit/delete all)
  const ADMIN_UID = null; // e.g. '5a09fd3a-f754-4827-874c-80ce7f662769';

  // Create client
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

  // ====== UTIL ======
  const $ = (id) => document.getElementById(id);
  const escapeHtml = (s) =>
    String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  const calcEdpi = (dpi, sens) => {
    const d = Number(dpi) || 0;
    const s = Number(sens) || 0;
    return d && s ? Math.round(d * s) : '';
  };

  // ====== AUTH UI ======
  async function refreshSessionUI() {
    const {
      data: { user },
    } = await sb.auth.getUser();

    const logoutBtn = $('logoutBtn');
    const loginBtn = $('loginBtn');
    const roleInd = $('roleIndicator');

    if (user) {
      logoutBtn.style.display = '';
      loginBtn.style.display = 'none';
      roleInd.textContent = `Signed in as ${user.email || user.user_metadata?.full_name || 'Discord user'}`;
      $('addBtn').disabled = false;
    } else {
      logoutBtn.style.display = 'none';
      loginBtn.style.display = '';
      roleInd.textContent = 'Welcome';
      $('addBtn').disabled = true; // must be logged in to add
    }
  }

  $('loginBtn')?.addEventListener('click', async () => {
    try {
      const redirectTo = window.location.origin;
      const { error } = await sb.auth.signInWithOAuth({
        provider: 'discord',
        options: { redirectTo },
      });
      if (error) alert(error.message);
    } catch (e) {
      alert(String(e));
    }
  });

  $('logoutBtn')?.addEventListener('click', async () => {
    await sb.auth.signOut();
  });

  sb.auth.onAuthStateChange((_event, _session) => {
    refreshSessionUI();
    loadProfiles();
  });

  // ====== DATA ======
  async function loadProfiles() {
    const tbody = $('profilesBody');
    tbody.innerHTML =
      '<tr><td colspan="12" style="text-align:center;color:var(--muted);padding:24px">Loading…</td></tr>';

    const { data, error } = await sb.from('profiles').select('*').order('created_at', { ascending: false });
    if (error) {
      tbody.innerHTML = `<tr><td colspan="12" class="muted" style="text-align:center;padding:24px">${escapeHtml(
        error.message
      )}</td></tr>`;
      return;
    }

    const term = ($('searchBar').value || '').toLowerCase();
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
      ]
        .join(' ')
        .toLowerCase();
      return !term || t.indexOf(term) !== -1;
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
          ? `<a class="secondary" href="${escapeHtml(p.pak_url)}" target="_blank" rel="noopener">Download</a>`
          : '<span class="muted">—</span>';
        const actions = mine
          ? `<button class="secondary" data-action="edit" data-id="${p.id}">Edit</button> 
             <button class="warn" data-action="delete" data-id="${p.id}">Delete</button>`
          : '<span class="muted">—</span>';
        return (
          '<tr>' +
          `<td><a class="nick" data-id="${p.id}">${escapeHtml(p.nickname || '')}</a></td>` +
          `<td>${escapeHtml(p.screen_hz || '')}</td>` +
          `<td>${escapeHtml(p.headphones || '')}</td>` +
          `<td>${escapeHtml(p.mouse || '')}</td>` +
          `<td>${escapeHtml(p.keyboard || '')}</td>` +
          `<td class="num">${p.dpi || ''}</td>` +
          `<td class="num">${p.sens || ''}</td>` +
          `<td class="num">${calcEdpi(p.dpi, p.sens)}</td>` +
          `<td class="center narrow">${p.zoom || ''}</td>` +
          `<td>${cfgCell}</td>` +
          `<td>${pakCell}</td>` +
          `<td style="text-align:right">${actions}</td>` +
          '</tr>'
        );
      })
      .join('');
  }

  $('searchBar').addEventListener('input', loadProfiles);

  // Delegated table actions
  $('profilesBody').addEventListener('click', async (e) => {
    const a = e.target.closest('a.nick');
    if (a) {
      const id = a.getAttribute('data-id');
      openPlayer(id);
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
  $('closePlayer').addEventListener('click', () => $('playerModal').classList.remove('open'));

  // Add/Edit
  $('addBtn').addEventListener('click', async () => {
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (!user) {
      alert('Login with Discord to add a profile.');
      return;
    }
    openEdit(null);
  });
  $('cancelEdit').addEventListener('click', () => $('editModal').classList.remove('open'));

  async function readCfg(file) {
    if (!file) return { name: null, text: null };
    if (file.size > 200 * 1024) throw new Error('CFG too large (max 200KB).');
    const text = await file.text();
    for (let i = 0; i < Math.min(64, text.length); i++) {
      if (text.charCodeAt(i) === 0) throw new Error('Only text-based .cfg allowed');
    }
    return { name: file.name, text };
  }

  function openEdit(id) {
    $('editTitle').textContent = id ? 'Edit Player' : 'Add Player';
    $('e_id').value = id || '';
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

  $('btnRemovePic').addEventListener('click', async () => {
    const id = $('e_id').value;
    if (!id) {
      alert('Open an existing profile to remove its pic.');
      return;
    }
    const { error } = await sb.from('profiles').update({ pic_url: null }).eq('id', id);
    if (error) alert(error.message);
    else {
      alert('Profile picture removed.');
      loadProfiles();
    }
  });

  $('btnRemoveCfg').addEventListener('click', async () => {
    const id = $('e_id').value;
    if (!id) {
      alert('Open an existing profile to remove its CFG.');
      return;
    }
    const { error } = await sb.from('profiles').update({ cfg_text: null, cfg_name: null }).eq('id', id);
    if (error) alert(error.message);
    else {
      alert('CFG removed.');
      loadProfiles();
    }
  });

  $('btnRemovePak').addEventListener('click', async () => {
    const id = $('e_id').value;
    if (!id) {
      alert('Open an existing profile to remove its Pak.');
      return;
    }
    const { error } = await sb.from('profiles').update({ pak_url: null, pak_name: null }).eq('id', id);
    if (error) alert(error.message);
    else {
      alert('Pak removed.');
      loadProfiles();
    }
  });

  $('editForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (!user) {
      alert('Login with Discord first.');
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

    // read optional files
    const picFile = $('e_pic').files[0] || null; // ≤ 5 MB
    const cfgFile = $('e_cfg').files[0] || null; // ≤ 200 KB
    const pakFile = $('e_pak').files[0] || null; // ≤ 50 MB

    try {
      // upsert base row first
      let rowId = id;
      if (!rowId) {
        const { data, error } = await sb.from('profiles').insert(rec).select('id').single();
        if (error) throw error;
        rowId = data.id;
      } else {
        const { error } = await sb.from('profiles').update(rec).eq('id', rowId);
        if (error) throw error;
      }

      // CFG upload (to table only)
      if (cfgFile) {
        const { name, text } = await readCfg(cfgFile);
        const { error } = await sb.from('profiles').update({ cfg_name: name, cfg_text: text }).eq('id', rowId);
        if (error) throw error;
      }

      // Picture upload (public URL from storage)
      if (picFile) {
        if (picFile.size > 5 * 1024 * 1024) throw new Error('Image too large (max 5MB).');
        const ext = (picFile.name.split('.').pop() || 'jpg').toLowerCase();
        const path = `${user.id}/${rowId}.${Date.now()}.${ext}`;
        const { error: upErr } = await sb.storage.from(PIC_BUCKET).upload(path, picFile, {
          upsert: true,
          contentType: picFile.type,
        });
        if (upErr) throw upErr;
        const { data: pub } = sb.storage.from(PIC_BUCKET).getPublicUrl(path);
        const { error: updErr } = await sb.from('profiles').update({ pic_url: pub.publicUrl }).eq('id', rowId);
        if (updErr) throw updErr;
      }

      // Pak upload (public URL)
      if (pakFile) {
        if (pakFile.size > 50 * 1024 * 1024) throw new Error('Pak too large (max 50MB).');
        const ext = (pakFile.name.split('.').pop() || 'zip').toLowerCase();
        const path = `${user.id}/${rowId}.${Date.now()}.${ext}`;
        const { error: upErr } = await sb.storage.from(PAK_BUCKET).upload(path, pakFile, {
          upsert: true,
          contentType: pakFile.type || 'application/octet-stream',
        });
        if (upErr) throw upErr;
        const { data: pub } = sb.storage.from(PAK_BUCKET).getPublicUrl(path);
        const { error: updErr } = await sb
          .from('profiles')
          .update({ pak_url: pub.publicUrl, pak_name: pakFile.name })
          .eq('id', rowId);
        if (updErr) throw updErr;
      }

      $('editModal').classList.remove('open');
      e.target.reset();
      loadProfiles();
    } catch (err) {
      alert(err.message || String(err));
    }
  });

  // ====== LOGO LOADER (Supabase Storage) ======
  async function loadHeaderLogo() {
    try {
      const el = document.getElementById('logoImg');
      if (!el || !window.supabase) return;

      // Try header.png first, then logo.png
      let publicUrl = null;
      let res = sb.storage.from('site-assets').getPublicUrl('header.png');
      if (res?.data?.publicUrl) {
        publicUrl = res.data.publicUrl;
      } else {
        res = sb.storage.from('site-assets').getPublicUrl('logo.png');
        if (res?.data?.publicUrl) publicUrl = res.data.publicUrl;
      }

      if (!publicUrl) {
        el.alt = 'Logo';
        return;
      }
      el.src = `${publicUrl}?v=${Date.now()}`; // cache-buster
      el.alt = 'Logo';
    } catch (e) {
      console.warn('Failed to load logo', e);
    }
  }

  // ====== INIT ======
  (async function init() {
    await refreshSessionUI();
    await loadHeaderLogo();
    loadProfiles();
  })();
})();
