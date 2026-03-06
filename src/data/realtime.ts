export type OrefRealtimeAlertsPayload = {
  data?: unknown;
  title?: unknown;
  cat?: unknown;
  alertDate?: unknown;
};

export type OrefRealtimeAlerts = {
  title: string | null;
  areas: string[];
  alertDateIso: string | null;
};

export function startRealtimeWebSocket(): () => void {
  return () => {};
}
