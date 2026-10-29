import { progressService } from '../storage/progress-store.js';

// Intentionally blank in v1. Configure only when a real authenticated API exists.
const SYNC_ENDPOINT = window.INTERACTIVE_LEARNING_SYNC_ENDPOINT || '';

/**
 * Future sync seam. Local saves always enter a pending queue. This function never
 * sends student results anywhere unless the developer explicitly configures an
 * API endpoint after implementing authentication, authorization, and consent.
 */
export async function syncPendingResults() {
  const pending = await progressService.getPendingSync();
  if (!pending.length) return { synced: 0, pending: 0, enabled: Boolean(SYNC_ENDPOINT) };
  if (!SYNC_ENDPOINT) return { synced: 0, pending: pending.length, enabled: false, reason: 'لا يوجد خادم مزامنة مفعّل؛ بقيت النتائج محفوظة محليًا.' };
  if (!navigator.onLine) return { synced: 0, pending: pending.length, enabled: true, reason: 'لا يوجد اتصال بالإنترنت؛ ستبقى النتائج في قائمة الانتظار.' };

  const response = await fetch(SYNC_ENDPOINT, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ schemaVersion: 1, results: pending.map((item) => item.payload) })
  });
  if (!response.ok) throw new Error(`تعذّرت المزامنة: HTTP ${response.status}`);
  await progressService.markSynced(pending.map((item) => item.id));
  return { synced: pending.length, pending: 0, enabled: true };
}
