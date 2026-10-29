const DB_NAME = 'interactive-learning-progress';
const DB_VERSION = 1;
const RESULTS_STORE = 'results';
const QUEUE_STORE = 'syncQueue';
const LOCAL_FALLBACK_KEY = 'interactive-learning-progress-fallback-v1';

/**
 * ProgressService is the app's storage contract. UI code should call this service
 * instead of using IndexedDB/localStorage directly. A future remote adapter can
 * implement the same methods without changing activity components.
 */
export class ProgressService {
  constructor() {
    this.dbPromise = null;
  }

  async open() {
    if (!('indexedDB' in globalThis)) return null;
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve) => {
        let request;
        try {
          request = indexedDB.open(DB_NAME, DB_VERSION);
        } catch (_) {
          resolve(null);
          return;
        }
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(RESULTS_STORE)) db.createObjectStore(RESULTS_STORE, { keyPath: 'id' });
          if (!db.objectStoreNames.contains(QUEUE_STORE)) db.createObjectStore(QUEUE_STORE, { keyPath: 'id' });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
        request.onblocked = () => resolve(null);
      });
    }
    return this.dbPromise;
  }

  readFallback() {
    try {
      return JSON.parse(localStorage.getItem(LOCAL_FALLBACK_KEY) || '{"results":{},"queue":[]}');
    } catch (_) {
      return { results: {}, queue: [] };
    }
  }

  writeFallback(data) {
    try {
      localStorage.setItem(LOCAL_FALLBACK_KEY, JSON.stringify(data));
    } catch (error) {
      throw new Error('تعذّر الحفظ على هذا الجهاز. تحقّق من المساحة المتاحة أو إعدادات الخصوصية.');
    }
  }

  async getResult(lessonId, activityId) {
    const id = `${lessonId}:${activityId}`;
    const db = await this.open();
    if (!db) return this.readFallback().results[id] || null;
    return new Promise((resolve) => {
      const request = db.transaction(RESULTS_STORE, 'readonly').objectStore(RESULTS_STORE).get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(this.readFallback().results[id] || null);
    });
  }

  async getResultsForLesson(lessonId) {
    const all = await this.getAllResults();
    return all.filter((item) => item.lessonId === lessonId);
  }

  async getAllResults() {
    const db = await this.open();
    if (!db) return Object.values(this.readFallback().results);
    return new Promise((resolve) => {
      const request = db.transaction(RESULTS_STORE, 'readonly').objectStore(RESULTS_STORE).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => resolve(Object.values(this.readFallback().results));
    });
  }

  /**
   * Result schema: lessonId, activityId, completed, answer, isCorrect, score,
   * submittedAt, studentWork. Every save also enqueues a sync record for later.
   */
  async saveResult(resultInput) {
    const id = `${resultInput.lessonId}:${resultInput.activityId}`;
    const record = {
      id,
      lessonId: resultInput.lessonId,
      activityId: resultInput.activityId,
      completed: Boolean(resultInput.completed),
      answer: resultInput.answer ?? null,
      isCorrect: resultInput.isCorrect ?? null,
      score: resultInput.score ?? null,
      submittedAt: resultInput.submittedAt || new Date().toISOString(),
      studentWork: resultInput.studentWork ?? null,
      updatedAt: new Date().toISOString()
    };
    const queueId = `${id}@${record.submittedAt}`;
    const queueItem = { id: queueId, resultId: id, lessonId: record.lessonId, createdAt: record.submittedAt, state: 'pending', payload: record };
    const db = await this.open();
    if (!db) {
      const fallback = this.readFallback();
      fallback.results[id] = record;
      if (!fallback.queue.some((item) => item.id === queueId)) fallback.queue.push(queueItem);
      this.writeFallback(fallback);
      return record;
    }
    await new Promise((resolve, reject) => {
      const tx = db.transaction([RESULTS_STORE, QUEUE_STORE], 'readwrite');
      tx.objectStore(RESULTS_STORE).put(record);
      tx.objectStore(QUEUE_STORE).put(queueItem);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error('تعذّر حفظ التقدم.'));
      tx.onabort = () => reject(tx.error || new Error('أُلغي حفظ التقدم.'));
    }).catch((error) => {
      const fallback = this.readFallback();
      fallback.results[id] = record;
      if (!fallback.queue.some((item) => item.id === queueId)) fallback.queue.push(queueItem);
      this.writeFallback(fallback);
      if (!fallback.results[id]) throw error;
    });
    return record;
  }

  async getPendingSync() {
    const db = await this.open();
    if (!db) return this.readFallback().queue.filter((item) => item.state === 'pending');
    return new Promise((resolve) => {
      const request = db.transaction(QUEUE_STORE, 'readonly').objectStore(QUEUE_STORE).getAll();
      request.onsuccess = () => resolve((request.result || []).filter((item) => item.state === 'pending'));
      request.onerror = () => resolve(this.readFallback().queue.filter((item) => item.state === 'pending'));
    });
  }

  async markSynced(queueIds) {
    if (!queueIds?.length) return;
    const db = await this.open();
    if (!db) {
      const fallback = this.readFallback();
      fallback.queue = fallback.queue.map((item) => queueIds.includes(item.id) ? { ...item, state: 'synced', syncedAt: new Date().toISOString() } : item);
      this.writeFallback(fallback);
      return;
    }
    await new Promise((resolve) => {
      const tx = db.transaction(QUEUE_STORE, 'readwrite');
      const store = tx.objectStore(QUEUE_STORE);
      queueIds.forEach((id) => {
        const request = store.get(id);
        request.onsuccess = () => {
          if (request.result) store.put({ ...request.result, state: 'synced', syncedAt: new Date().toISOString() });
        };
      });
      tx.oncomplete = resolve;
      tx.onerror = resolve;
    });
  }
}

export const progressService = new ProgressService();
