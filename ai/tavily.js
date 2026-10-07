    const rerankScore = Math.max(0, Math.min(1.5,
      base * 0.35 +
      core.coreScore * 0.55 +
      claimBonus +
      requestedBonus
    ));

    return {
      ...result,
      _coreScore: core.coreScore,
      _rerankScore: rerankScore,
      _host: core.host,
      _key: core.key,
      _index: index,
    };
  });

  const sorted = candidates.sort((a,b) => b._rerankScore - a._rerankScore);
  const selected = [];
  const hosts = new Set();
  const maxSources = Math.max(1, input.length);
  const minIndependent = Math.min(2, input.length);

  // Preserve relevance order, but reserve a slot for an independent host
  // when the result set contains one.
  for (const item of sorted) {
    if (selected.length >= maxSources) break;
    if (selected.some(prev => prev._key === item._key)) continue;
    if (item._host && hosts.has(item._host) && hosts.size < minIndependent) continue;
    selected.push(item);
    if (item._host) hosts.add(item._host);
  }

  for (const item of sorted) {
    if (selected.length >= maxSources) break;
    if (selected.some(prev => prev._key === item._key)) continue;
    selected.push(item);
  }

  return selected.map(({_coreScore,_rerankScore,_host,_key,_index,...result}) => result);
}

function ocenaZrodlaLokalnie(url, requestedDomains = []) {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    const requested = requestedDomains.some(d => {
      const clean = String(d || '').toLowerCase().replace(/^www\./, '');