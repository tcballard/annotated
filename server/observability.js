const metrics = {
  startedAt: Date.now(),
  requests: 0,
  errors: 0,
  statuses: new Map(),
  routes: new Map(),
};

export const recordRequest = ({ method, path, status, durationMs }) => {
  metrics.requests += 1;
  if (status >= 500) metrics.errors += 1;
  metrics.statuses.set(String(status), (metrics.statuses.get(String(status)) || 0) + 1);
  const route = `${method} ${path}`.slice(0, 160);
  const current = metrics.routes.get(route) || { count: 0, totalMs: 0, maxMs: 0 };
  current.count += 1;
  current.totalMs += Math.max(0, Number(durationMs) || 0);
  current.maxMs = Math.max(current.maxMs, Number(durationMs) || 0);
  metrics.routes.set(route, current);
  if (metrics.routes.size > 500) metrics.routes.delete(metrics.routes.keys().next().value);
};

export const metricsSnapshot = () => ({
  uptimeSeconds: Math.floor((Date.now() - metrics.startedAt) / 1000),
  requests: metrics.requests,
  errors: metrics.errors,
  statuses: Object.fromEntries(metrics.statuses),
  routes: Object.fromEntries([...metrics.routes.entries()].map(([route, value]) => [route, {
    count: value.count,
    averageMs: value.count ? Math.round(value.totalMs / value.count) : 0,
    maxMs: Math.round(value.maxMs),
  }])),
});

export const resetMetrics = () => {
  metrics.startedAt = Date.now();
  metrics.requests = 0;
  metrics.errors = 0;
  metrics.statuses.clear();
  metrics.routes.clear();
};

