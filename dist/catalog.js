export function validStream(value) {
  try {
    const url = new URL(value.trim());
    return url.origin === 'https://atcs.denpasarkota.go.id' &&
      /^\/stream\/+[a-zA-Z0-9_-]+\/$/.test(url.pathname) && !url.search && !url.hash && !url.username && !url.password;
  } catch { return false; }
}

export function normalizeCatalogue(data) {
  if (!Array.isArray(data.cameras)) throw new Error('Invalid camera catalogue');
  const seen = new Set();
  const cameras = data.cameras.filter(camera => {
    if (!camera || typeof camera.id !== 'string' || seen.has(camera.id) ||
      typeof camera.name !== 'string' || typeof camera.location !== 'string' ||
      typeof camera.description !== 'string' || !validStream(camera.url)) return false;
    seen.add(camera.id);
    return true;
  }).map(camera => ({ ...camera, url: camera.url.trim() }));
  if (!cameras.length) throw new Error('The catalogue contains no public camera feeds');
  return { cameras, updatedAt: data.updatedAt || 'Unknown' };
}

export function filterCameras(cameras, { query = '', location = '', favoritesOnly = false, favorites = new Set() } = {}) {
  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return cameras.filter(camera => (!location || camera.location === location) &&
    (!favoritesOnly || favorites.has(camera.id)) &&
    terms.every(term => `${camera.name} ${camera.location} ${camera.description}`.toLocaleLowerCase().includes(term)));
}

export function paginate(cameras, page, pageSize) {
  const pages = Math.max(1, Math.ceil(cameras.length / pageSize));
  const current = Math.max(1, Math.min(page, pages));
  return { page: current, pages, items: cameras.slice((current - 1) * pageSize, current * pageSize) };
}
