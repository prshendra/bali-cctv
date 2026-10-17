export function playbackLimit(isCompact) {
  return isCompact ? 1 : Infinity;
}

export function playerKeysToStop(activeKeys, targetKey, limit) {
  if (!Number.isFinite(limit)) return [];
  const keep = new Set([targetKey, ...activeKeys.filter(key => key !== targetKey)].slice(0, Math.max(0, limit)));
  return activeKeys.filter(key => !keep.has(key));
}
