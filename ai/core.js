  const game = String(routing.game || routing.resolved_entity?.game || '').trim();
  const base = [];
  const add = (x, reason = 'primary') => {
    const v = String(x || '').replace(/\s+/g, ' ').trim();
    if (v.length < 8) return;
    const key = normalize(v);
    if (!base.some(x => normalize(x.query) === key)) base.push({ query:v, reason });
  };

  add(q);
  if (entity) add(`${entity} ${q}`);
  if (game && game !== entity) add(`${game} ${q}`);

  if (routing.is_lore) {
    add(`${game || entity || q} lore plot canon story`, 'lore');
    add(`${game || entity || q} character relationship story`, 'lore');
  }
  if (routing.is_gameplay) {
    add(`${game || entity || q} walkthrough guide solution`, 'gameplay');
    add(`${game || entity || q} quest mission guide`, 'gameplay');
  }
  if (routing.freshness === 'live') add(`${entity || game || q} latest official`);
  if (routing.freshness === 'recent') add(`${entity || game || q} latest news`);

  const max = Math.max(1, Math.min(5, Number(options.maxQueries) || 4));
  return base.slice(0, max).map((x, i) => ({
    query:x.query,
    priority:i === 0 ? 'primary' : i === 1 ? 'secondary' : 'fallback',
    reason:x.reason,
  }));
}