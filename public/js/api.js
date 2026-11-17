export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  if (res.status === 401) {
    const d = await res.json().catch(() => ({}));
    if (!location.pathname.startsWith('/login')) location.href = d.expired ? '/login?expired=1' : '/login';
    throw new Error(d.message || 'Sesi berakhir.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.message || `Galat ${res.status}`), { status: res.status });
  return data;
}
