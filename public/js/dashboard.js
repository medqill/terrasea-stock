import './layout.js';
import { api } from './api.js';
import { h, $, $$, clear } from './dom.js';
import { fmtDate, fmtMonth, fixtureChip } from './labels.js';

const table = (head, rows, emptyText) => rows.length
  ? h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, head.map((t) => h('th', { scope: 'col' }, t)))), h('tbody', {}, rows.map((r) => h('tr', {}, r.map((c) => h('td', {}, c)))))))
  : h('p', { class: 'muted' }, emptyText);

function renderLinkAge(u) {
  if (!u.expires_at) {
    return h('span', { class: 'muted' }, 'Tanpa tautan');
  }
  const now = Date.now();
  const diff = Number(u.expires_at) - now;
  if (diff <= 0) {
    const expiredHoursAgo = Math.max(1, Math.round(Math.abs(diff) / 3600000));
    return h('span', {
      class: 'chip',
      style: 'border-color: var(--abund-low); color: var(--abund-low); font-weight: 600;'
    }, `Kedaluwarsa (${expiredHoursAgo}j lalu)`);
  }
  const hours = Math.floor(diff / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  return h('span', {
    class: 'chip',
    style: 'border-color: var(--abund-high); color: var(--abund-high);'
  }, `Aktif (sisa ${hours}j ${mins}m)`);
}

function renderModelStatus(m) {
  const bannerBox = $('#model-banner');
  const modelBox = $('#model');
  if (!modelBox) return;

  if (!m) {
    clear(modelBox).append(h('p', { class: 'muted' }, 'Data olahan belum tersedia. Jalankan pipeline di ml/.'));
    if (bannerBox) clear(bannerBox);
    return;
  }

  if (bannerBox) {
    if (m.is_fixture) {
      clear(bannerBox).append(
        h('div', {
          style: 'padding: var(--s3) var(--s4); border: 2px solid var(--abund-low); background: rgba(217, 105, 94, 0.12); border-radius: var(--radius); display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--s2);'
        }, [
          h('div', {}, [
            h('strong', { style: 'color: var(--abund-low); display: block; font-size: 15px;' }, '⚠ PERINGATAN: DATA CONTOH (FIXTURE) SEDANG AKTIF'),
            h('span', { style: 'font-size: 13px; color: var(--text);' }, 'Publik saat ini melihat data statis tiruan, BUKAN hasil model Machine Learning. Jalankan pipeline ML dan seed artifacts untuk menyajikan data asli.')
          ]),
          fixtureChip()
        ])
      );
    } else {
      clear(bannerBox).append(
        h('div', {
          style: 'padding: var(--s3) var(--s4); border: 1px solid var(--abund-high); background: rgba(125, 184, 138, 0.12); border-radius: var(--radius); display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--s2);'
        }, [
          h('div', {}, [
            h('strong', { style: 'color: var(--abund-high); display: block; font-size: 15px;' }, '✔ DATA PREDIKSI RESMI AKTIF'),
            h('span', { style: 'font-size: 13px; color: var(--text);' }, `Model ${m.model_version} aktif. Publik saat ini melihat hasil peramalan valid dari data lapangan dan oseanografi.`)
          ]),
          h('span', { class: 'chip', style: 'border-color: var(--abund-high); color: var(--abund-high); font-weight: 600;' }, 'Resmi ML')
        ])
      );
    }
  }

  clear(modelBox).append(
    h('dl', { class: 'metrics' }, [
      ['Versi model', m.model_version],
      ['Dihasilkan', fmtDate(m.generated_at)],
      ['Bulan data', fmtMonth(m.month)],
      ['Jumlah zona', `${m.zone_count} zona (Z-01 & Z-02)`]
    ].map(([k, v]) => h('div', {}, h('dt', {}, k), h('dd', {}, v))),
    m.is_fixture ? fixtureChip() : ''
    )
  );
}

async function loadStatsAndPending() {
  const s = await api('/admin/stats');
  $('#stats').replaceChildren(...[
    ['Total akun', s.accounts.total],
    ['Akun aktif', s.accounts.active],
    ['Menunggu verifikasi', s.accounts.pending]
  ].map(([k, v]) => h('div', { class: 'panel' }, h('p', { class: 'label' }, k), h('strong', {}, v))));

  renderModelStatus(s.model);

  const pendingRows = (s.pending || []).map((u) => {
    const ageCell = renderLinkAge(u);
    const actionCell = h('div', { style: 'display: flex; gap: var(--s2); flex-wrap: wrap;' }, [
      h('button', {
        type: 'button',
        class: 'btn btn--primary',
        style: 'padding: 3px 10px; font-size: 12px;',
        onclick: async () => {
          if (!confirm(`Aktifkan akun "${u.email}" secara manual sekarang?`)) return;
          try {
            const res = await api(`/admin/users/${u.id}/activate`, { method: 'POST' });
            alert(res.message);
            await reloadAll();
          } catch (err) {
            alert(err.message);
          }
        }
      }, 'Aktifkan Manual'),
      h('button', {
        type: 'button',
        class: 'btn btn--outline',
        style: 'padding: 3px 10px; font-size: 12px; border-color: var(--abund-low); color: var(--abund-low);',
        onclick: async () => {
          if (!confirm(`Hapus pendaftaran akun "${u.email}"?`)) return;
          try {
            const res = await api(`/admin/users/${u.id}`, { method: 'DELETE' });
            alert(res.message);
            await reloadAll();
          } catch (err) {
            alert(err.message);
          }
        }
      }, 'Hapus')
    ]);

    return [
      h('strong', {}, u.name),
      u.email,
      fmtDate(u.created_at),
      ageCell,
      actionCell
    ];
  });

  clear($('#pending')).append(
    table(['Nama', 'Email', 'Mendaftar', 'Umur Tautan', 'Aksi'], pendingRows, 'Tidak ada akun yang menunggu verifikasi.')
  );
}

async function loadUsers() {
  const container = $('#users');
  if (!container) return;
  try {
    const data = await api('/admin/users');
    const rows = (data.users || []).map((u) => {
      let statusBadge;
      if (u.status === 'active') {
        statusBadge = h('span', { class: 'chip', style: 'border-color: var(--abund-high); color: var(--abund-high);' }, 'Aktif');
      } else if (u.status === 'inactive') {
        statusBadge = h('span', { class: 'chip', style: 'border-color: var(--abund-low); color: var(--abund-low); font-weight:600;' }, 'Nonaktif');
      } else {
        statusBadge = h('span', { class: 'chip', style: 'border-color: var(--abund-mid); color: var(--abund-mid);' }, 'Pending');
      }

      const roleBadge = h('span', {
        class: u.role === 'admin' ? 'chip chip--fixture' : 'chip',
        style: u.role === 'admin' ? 'font-weight:600;' : ''
      }, u.role === 'admin' ? 'Admin' : 'User');

      const lastSeen = u.last_seen ? fmtDate(u.last_seen) : h('span', { class: 'muted' }, 'Belum pernah');

      let actionBtn;
      if (u.status === 'active') {
        actionBtn = h('button', {
          type: 'button',
          class: 'btn btn--outline',
          style: 'padding: 3px 10px; font-size: 12px; border-color: var(--abund-low); color: var(--abund-low);',
          onclick: async () => {
            if (!confirm(`Nonaktifkan akun "${u.email}"? Pengguna tidak akan dapat mengakses sistem.`)) return;
            try {
              const res = await api(`/admin/users/${u.id}/deactivate`, { method: 'POST' });
              alert(res.message);
              await reloadAll();
            } catch (err) {
              alert(err.message);
            }
          }
        }, 'Nonaktifkan');
      } else if (u.status === 'inactive') {
        actionBtn = h('button', {
          type: 'button',
          class: 'btn btn--primary',
          style: 'padding: 3px 10px; font-size: 12px;',
          onclick: async () => {
            if (!confirm(`Aktifkan kembali akun "${u.email}"?`)) return;
            try {
              const res = await api(`/admin/users/${u.id}/activate`, { method: 'POST' });
              alert(res.message);
              await reloadAll();
            } catch (err) {
              alert(err.message);
            }
          }
        }, 'Aktifkan');
      } else {
        actionBtn = h('div', { style: 'display:flex; gap:var(--s2);' }, [
          h('button', {
            type: 'button',
            class: 'btn btn--primary',
            style: 'padding: 3px 8px; font-size: 12px;',
            onclick: async () => {
              if (!confirm(`Aktifkan akun "${u.email}"?`)) return;
              try {
                const res = await api(`/admin/users/${u.id}/activate`, { method: 'POST' });
                alert(res.message);
                await reloadAll();
              } catch (err) {
                alert(err.message);
              }
            }
          }, 'Aktifkan'),
          h('button', {
            type: 'button',
            class: 'btn btn--outline',
            style: 'padding: 3px 8px; font-size: 12px; border-color: var(--abund-low); color: var(--abund-low);',
            onclick: async () => {
              if (!confirm(`Hapus akun "${u.email}"?`)) return;
              try {
                const res = await api(`/admin/users/${u.id}`, { method: 'DELETE' });
                alert(res.message);
                await reloadAll();
              } catch (err) {
                alert(err.message);
              }
            }
          }, 'Hapus')
        ]);
      }

      return [
        h('strong', {}, u.name),
        u.email,
        roleBadge,
        statusBadge,
        lastSeen,
        actionBtn
      ];
    });

    clear(container).append(
      table(['Nama', 'Email', 'Peran', 'Status', 'Terakhir Masuk', 'Aksi'], rows, 'Belum ada akun terdaftar.')
    );
  } catch (err) {
    clear(container).append(h('p', { class: 'muted' }, `Gagal memuat akun: ${err.message}`));
  }
}

async function loadDownloads() {
  const container = $('#downloads');
  const summaryBox = $('#downloads-summary');
  if (!container) return;

  const type = $('#filter-type')?.value || 'all';
  const periodFrom = $('#filter-from')?.value || '';
  const periodTo = $('#filter-to')?.value || '';

  const params = new URLSearchParams();
  if (type && type !== 'all') params.set('type', type);
  if (periodFrom) params.set('period_from', periodFrom);
  if (periodTo) params.set('period_to', periodTo);

  try {
    const data = await api(`/admin/downloads?${params.toString()}`);
    
    // Render Ringkasan Unduhan Terbanyak
    if (summaryBox && data.summary) {
      clear(summaryBox).append(
        h('div', {
          style: 'display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: var(--s3);'
        }, [
          h('div', { class: 'panel', style: 'padding: var(--s3); background: var(--surface-2);' }, [
            h('span', { class: 'label', style: 'font-size: 11px; text-transform: uppercase; letter-spacing:.06em; color:var(--text-muted);' }, 'Total Unduhan'),
            h('strong', { style: 'font-size: 24px; display: block; margin-top: var(--s1); font-family: var(--font-mono);' }, String(data.summary.total))
          ]),
          h('div', { class: 'panel', style: 'padding: var(--s3); background: var(--surface-2);' }, [
            h('span', { class: 'label', style: 'font-size: 11px; text-transform: uppercase; letter-spacing:.06em; color:var(--text-muted);' }, 'Unduhan Terbanyak (Jenis)'),
            h('strong', { style: 'font-size: 16px; display: block; margin-top: var(--s1); color: var(--accent);' }, data.summary.top_type)
          ]),
          h('div', { class: 'panel', style: 'padding: var(--s3); background: var(--surface-2);' }, [
            h('span', { class: 'label', style: 'font-size: 11px; text-transform: uppercase; letter-spacing:.06em; color:var(--text-muted);' }, 'Pengguna Paling Aktif'),
            h('strong', { style: 'font-size: 14px; display: block; margin-top: var(--s1); word-break: break-all;' }, data.summary.top_user)
          ]),
          h('div', { class: 'panel', style: 'padding: var(--s3); background: var(--surface-2);' }, [
            h('span', { class: 'label', style: 'font-size: 11px; text-transform: uppercase; letter-spacing:.06em; color:var(--text-muted);' }, 'Kelompok Ikan Terpopuler'),
            h('strong', { style: 'font-size: 16px; display: block; margin-top: var(--s1);' }, data.summary.top_group)
          ])
        ])
      );
    }

    // Render Tabel
    const rows = (data.downloads || []).map((d) => [
      fmtDate(d.created_at),
      d.email ?? h('span', { class: 'muted' }, 'Tamu / anonim'),
      h('strong', {}, d.type.toUpperCase()),
      `${d.period_from ?? 'Awal'} s.d. ${d.period_to ?? 'Akhir'}`,
      d.fish_group || h('span', { class: 'muted' }, '-')
    ]);

    clear(container).append(
      table(['Waktu', 'Pengguna', 'Jenis', 'Periode', 'Kelompok'], rows, 'Tidak ada log unduhan yang cocok dengan filter.')
    );
  } catch (err) {
    clear(container).append(h('p', { class: 'muted' }, `Gagal memuat log unduhan: ${err.message}`));
  }
}

async function loadApiKeys() {
  const container = $('#api-keys');
  if (!container) return;
  try {
    const data = await api('/admin/api-keys');
    const rows = (data.keys || []).map((k) => {
      const isRevoked = Boolean(k.revoked_at);
      const revokeBtn = isRevoked
        ? h('span', { class: 'muted' }, 'Dicabut')
        : h('button', {
            type: 'button',
            class: 'btn btn--outline',
            style: 'padding: 2px 8px; font-size: 12px;',
            onclick: async () => {
              if (!confirm(`Cabut kunci API "${k.name}"? Bot yang menggunakan kunci ini tidak dapat mengakses API lagi.`)) return;
              try {
                await api(`/admin/api-keys/${k.id}`, { method: 'DELETE' });
                await loadApiKeys();
              } catch (err) {
                alert(err.message);
              }
            }
          }, 'Cabut');

      return [
        h('strong', {}, k.name),
        h('code', { style: 'font-size:12px;' }, k.scopes),
        fmtDate(k.created_at),
        k.last_used_at ? fmtDate(k.last_used_at) : h('span', { class: 'muted' }, 'Belum pernah'),
        revokeBtn
      ];
    });

    clear(container).append(
      table(['Nama', 'Scopes', 'Dibuat', 'Terakhir Digunakan', 'Aksi'], rows, 'Belum ada kunci API bot yang dibuat.')
    );
  } catch (err) {
    clear(container).append(h('p', { class: 'muted' }, `Gagal memuat kunci API: ${err.message}`));
  }
}

async function loadIngestLogs() {
  const container = $('#ingest-logs');
  if (!container) return;
  try {
    const data = await api('/admin/ingest-logs');
    const rows = (data.logs || []).map((l) => [
      fmtDate(l.created_at),
      h('code', { style: 'font-size:12px;' }, l.endpoint),
      l.key_name || h('span', { class: 'muted' }, '-'),
      h('span', {
        class: l.status >= 200 && l.status < 300 ? 'chip' : 'chip chip--fixture'
      }, String(l.status)),
      l.rows ?? 0,
      l.detail || '-'
    ]);

    clear(container).append(
      table(['Waktu', 'Endpoint', 'Kunci API', 'Status', 'Baris', 'Detail'], rows, 'Belum ada log ingest.')
    );
  } catch (err) {
    clear(container).append(h('p', { class: 'muted' }, `Gagal memuat log ingest: ${err.message}`));
  }
}

async function reloadAll() {
  await Promise.all([
    loadStatsAndPending(),
    loadUsers(),
    loadDownloads()
  ]);
}

// Event handlers
const formKey = $('#form-create-key');
if (formKey) {
  formKey.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nameInput = $('#key-name');
    const name = nameInput.value.trim();
    const selectedScopes = $$('input[name="scopes"]:checked', formKey).map((cb) => cb.value);

    if (!name) {
      alert('Nama kunci wajib diisi.');
      return;
    }
    if (selectedScopes.length === 0) {
      alert('Pilih minimal satu scope.');
      return;
    }

    try {
      const res = await api('/admin/api-keys', {
        method: 'POST',
        body: { name, scopes: selectedScopes }
      });

      const box = $('#new-key-box');
      const val = $('#new-key-val');
      if (box && val) {
        val.textContent = res.key;
        box.style.display = 'block';
      }

      nameInput.value = '';
      await loadApiKeys();
    } catch (err) {
      alert(`Gagal membuat kunci: ${err.message}`);
    }
  });
}

const copyBtn = $('#btn-copy-key');
if (copyBtn) {
  copyBtn.addEventListener('click', () => {
    const keyVal = $('#new-key-val')?.textContent;
    if (keyVal) {
      navigator.clipboard.writeText(keyVal).then(() => {
        copyBtn.textContent = 'Tersalin!';
        setTimeout(() => { copyBtn.textContent = 'Salin'; }, 2000);
      });
    }
  });
}

const formFilterDownloads = $('#form-filter-downloads');
if (formFilterDownloads) {
  formFilterDownloads.addEventListener('submit', (e) => {
    e.preventDefault();
    loadDownloads();
  });
}

const btnResetDownloads = $('#btn-reset-downloads');
if (btnResetDownloads) {
  btnResetDownloads.addEventListener('click', () => {
    const filterType = $('#filter-type');
    const filterFrom = $('#filter-from');
    const filterTo = $('#filter-to');
    if (filterType) filterType.value = 'all';
    if (filterFrom) filterFrom.value = '';
    if (filterTo) filterTo.value = '';
    loadDownloads();
  });
}

(async () => {
  try {
    await reloadAll();
    await loadApiKeys();
    await loadIngestLogs();
  } catch (e) {
    $('#model').textContent = e.message;
  }
})();
