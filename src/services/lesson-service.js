const INDEX_URL = new URL('lessons/index.json', document.baseURI);
const STUDENT_CATALOG_KEY = 'interactive-learning-student-catalog';
const isValidIndex = (value) => Boolean(value && Array.isArray(value.subjects) && Array.isArray(value.lessons));
const readStudentCache = () => {
  try { return JSON.parse(localStorage.getItem(STUDENT_CATALOG_KEY) || 'null'); }
  catch (_) { return null; }
};

export async function loadLessonIndex() {
  // The deployed JSON file on GitHub Pages is the source of truth.
  let response = null;
  try { response = await fetch(INDEX_URL, { cache: 'no-store' }); }
  catch (_) { response = null; }

  if (response?.ok) {
    const index = await response.json();
    if (!isValidIndex(index)) throw new Error('ملف lessons/index.json غير صالح.');
    try { localStorage.setItem(STUDENT_CATALOG_KEY, JSON.stringify(index)); } catch (_) {}
    return index;
  }

  // Offline fallback: first try the service worker cache, then the last known student catalog.
  try {
    const cache = await caches.open('interactive-learning-v3-lessons');
    const cachedResponse = await cache.match(INDEX_URL.href);
    if (cachedResponse) {
      const index = await cachedResponse.json();
      if (isValidIndex(index)) return index;
    }
  } catch (_) {}
  const saved = readStudentCache();
  if (isValidIndex(saved)) return saved;
  throw new Error('تعذّر تحميل قائمة الدروس. تحقّق من الاتصال أو من وجود lessons/index.json في الموقع.');
}

export async function loadLesson(indexEntry) {
  // Lessons added from the management page are embedded in the single remote catalog JSON.
  if (indexEntry?.lessonData && typeof indexEntry.lessonData === 'object') {
    const lessonUrl = indexEntry.lessonFile || document.baseURI;
    return {
      ...indexEntry.lessonData,
      __lessonFile: indexEntry.lessonFile || 'lessons/index.json',
      __lessonUrl: new URL(lessonUrl, document.baseURI).href,
      __indexEntry: indexEntry
    };
  }

  const lessonUrl = new URL(indexEntry.lessonFile, document.baseURI);
  let response;
  try { response = await fetch(lessonUrl); }
  catch (_) { response = null; }
  if (!response?.ok) {
    let cached = null;
    try { cached = await (await caches.open('interactive-learning-v3-lessons')).match(lessonUrl.href); } catch (_) {}
    if (cached) response = cached;
  }
  if (!response?.ok) {
    if (!response) throw new Error('هذا الدرس غير محفوظ على الجهاز بعد. اتصل بالإنترنت ثم افتحه ونزّله للتشغيل دون إنترنت.');
    throw new Error('تعذّر فتح ملف بيانات الدرس. تحقّق من أن مجلد الدرس وملف lesson.json موجودان.');
  }
  const lesson = await response.json();
  return { ...lesson, __lessonFile: indexEntry.lessonFile, __lessonUrl: lessonUrl.href, __indexEntry: indexEntry };
}

export function findLesson(index, query) {
  const normalized = String(query || '').trim().toLocaleLowerCase();
  if (!normalized) return null;
  return index.lessons.find((entry) => String(entry.id || '').toLocaleLowerCase() === normalized || String(entry.shortCode || '').toLocaleLowerCase() === normalized) || null;
}

export function lessonAssetUrl(lesson, path) {
  const value = String(path ?? '');
  if (/^(data:|blob:)/i.test(value)) return value;
  // Convert Google Drive sharing links to direct download links
  const driveMatch = value.match(/https?:\/\/drive\.google\.com\/file\/d\/([^/?#]+)/i);
  if (driveMatch) return `https://drive.google.com/uc?export=download&id=${driveMatch[1]}`;
  if (/^https?:/i.test(value)) return value;
  return new URL(value, lesson.__lessonUrl).href;
}

export async function downloadLessonResources(indexEntry, lesson, onProgress = () => {}) {
  const paths = new Set();
  if (!indexEntry.lessonData) paths.add(indexEntry.lessonFile);
  if (lesson.pdf) paths.add(lesson.pdf);
  if (lesson.coverImage) paths.add(lesson.coverImage);
  for (const page of lesson.pages || []) if (page.previewImage) paths.add(page.previewImage);
  for (const file of lesson.audioFiles || []) paths.add(file);
  for (const page of lesson.pages || []) {
    for (const activity of page.activities || []) if (activity.audio && !/^(data:|blob:|https?:)/i.test(activity.audio)) paths.add(activity.audio);
  }
  const urls = [...paths].map((path) => path === indexEntry.lessonFile && !indexEntry.lessonData
    ? new URL(path, document.baseURI).href
    : lessonAssetUrl(lesson, path));
  const cache = await caches.open('interactive-learning-v3-lessons');
  const failures = [];
  let completed = 0;
  for (const url of urls) {
    try {
      const existing = await cache.match(url);
      if (existing) {
        completed += 1;
        onProgress({ completed, total: urls.length, url });
        continue;
      }
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await cache.put(url, response.clone());
      completed += 1;
    } catch (error) {
      failures.push({ url, reason: String(error) });
    }
    onProgress({ completed, total: urls.length, url });
  }
  return { total: urls.length, completed, failures, ready: failures.length === 0 };
}

export async function isLessonDownloaded(indexEntry, lesson) {
  try {
    const cache = await caches.open('interactive-learning-v3-lessons');
    const jsonUrl = indexEntry.lessonData ? '' : new URL(indexEntry.lessonFile, document.baseURI).href;
    const pdfUrl = lessonAssetUrl(lesson, lesson.pdf);
    return Boolean((!jsonUrl || await cache.match(jsonUrl)) && await cache.match(pdfUrl));
  } catch (_) {
    return false;
  }
}
