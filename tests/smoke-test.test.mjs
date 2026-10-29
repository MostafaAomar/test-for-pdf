import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const loadJson = async (relative) => JSON.parse(await readFile(path.join(root, relative), 'utf8'));
const readText = async (relative) => readFile(path.join(root, relative), 'utf8');
const exists = async (relative) => access(path.join(root, relative)).then(() => true, () => false);

test('فهرس المنهج يحتوي مواد وصفوفًا ووحدات ويربط الدرس بموقعه', async () => {
  const index = await loadJson('lessons/index.json');
  assert.equal(index.schemaVersion, 2);
  assert.ok(index.subjects.some((subject) => subject.id === 'english'));
  const english = index.subjects.find((subject) => subject.id === 'english');
  const bac = english.grades.find((grade) => grade.id === 'baccalaureate');
  assert.deepEqual(bac.units.map((unit) => unit.id), ['unit-1', 'unit-2', 'unit-3']);
  assert.equal(index.lessons[0].id, 'sample-lesson');
  assert.equal(index.lessons[0].subjectId, 'english');
  assert.equal(index.lessons[0].gradeId, 'baccalaureate');
  assert.equal(index.lessons[0].unitId, 'unit-1');
  assert.equal(index.lessons[0].shortCode, 'FRUIT1');
  assert.equal(await exists('lessons/sample-lesson/lesson.json'), true);
});

test('ملف الدرس يضم أنواع الأنشطة الستة وكل المسارات المحلية موجودة', async () => {
  const lesson = await loadJson('lessons/sample-lesson/lesson.json');
  const types = new Set((lesson.pages || []).flatMap((page) => (page.activities || []).map((activity) => activity.type)));
  for (const type of ['audio', 'read_aloud', 'mcq', 'matching', 'text_answer', 'drawing']) assert.ok(types.has(type), `Missing activity: ${type}`);
  assert.equal(await exists(`lessons/sample-lesson/${lesson.pdf}`), true);
  assert.equal(await exists(`lessons/sample-lesson/${lesson.coverImage}`), true);
  for (const pathName of lesson.audioFiles || []) assert.equal(await exists(`lessons/sample-lesson/${pathName}`), true, pathName);
  for (const page of lesson.pages) {
    assert.equal(await exists(`lessons/sample-lesson/${page.previewImage}`), true, page.previewImage);
    for (const activity of page.activities || []) {
      const position = activity.position;
      assert.ok(position && position.x >= 0 && position.x <= 100, `${activity.id} x out of range`);
      assert.ok(position.y >= 0 && position.y <= 100, `${activity.id} y out of range`);
      assert.ok(position.w > 0 && position.w <= 100, `${activity.id} w out of range`);
      assert.ok(activity.id && activity.title && activity.prompt, `Missing common fields in ${activity.id}`);
      if (activity.type === 'mcq') assert.ok(activity.choices.some((choice) => choice.id === activity.correctAnswer));
      if (activity.type === 'matching') assert.ok(Object.keys(activity.correctPairs).length === activity.pairs.length);
    }
  }
});

test('PDF محلي صالح وبعدد الصفحات المتوقّع', async () => {
  const pdf = await readFile(path.join(root, 'lessons/sample-lesson/lesson.pdf'));
  assert.equal(pdf.subarray(0, 5).toString('ascii'), '%PDF-');
  const pageCount = (pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length;
  assert.equal(pageCount, 3);
});

test('عارض الدرس يعرض علامات الأنشطة وأدوات الكتابة والرسم ويحفظ التقدم محليًا', async () => {
  const main = await readText('src/main.js');
  const store = await readText('src/storage/progress-store.js');
  const viewer = await readText('src/viewer/pdf-viewer.js');
  const sw = await readText('sw.js');
  assert.match(main, /data-subject-id/);
  assert.match(main, /data-grade-id/);
  assert.match(main, /data-unit-id/);
  assert.match(main, /page-activities/);
  assert.match(main, /downloadLessonResources/);
  assert.match(main, /openActivityDialog/);
  assert.match(main, /page-annotate/);
  assert.match(main, /__page-annotation-/);
  assert.doesNotMatch(main, /class="side-panel"/);
  assert.match(store, /indexedDB\.open/);
  assert.match(store, /submittedAt/);
  assert.match(store, /studentWork/);
  assert.match(store, /syncQueue/);
  assert.match(viewer, /GlobalWorkerOptions\.workerSrc/);
  assert.match(viewer, /useSystemFonts: true/);
  assert.match(viewer, /startAnnotation/);
  assert.match(viewer, /activity-marker-layer/);
  assert.match(viewer, /toggleMarkerAudio/);
  const contentValidator = await readText('scripts/validate-content.mjs');
  assert.match(contentValidator, /audio has no position/);
  assert.match(viewer, /pageData\.previewImage/);
  assert.match(viewer, /data-tool=\"text\"/);
  assert.match(viewer, /annotation-text-editor/);
  assert.match(viewer, /globalCompositeOperation = activeTool === 'eraser'/);
  assert.equal(await exists('tools/generate_pdf_previews.py'), true);
  assert.match(sw, /CACHE_URLS/);
  assert.match(sw, /interactive-learning-v3/);
  assert.match(sw, /request\.mode === 'navigate'/);
});


test('وضع المطوّر مخفي افتراضيًا ويتيح حفظ/تصدير التفاعلات وإرفاق الصوت', async () => {
  const main = await readText('src/main.js');
  const viewer = await readText('src/viewer/pdf-viewer.js');
  const styles = await readText('src/styles.css');
  assert.match(main, /developerAccessEnabled/);
  assert.match(main, /developer-save-config/);
  assert.match(main, /developer-export-config/);
  assert.match(main, /developer-delete-activity/);
  assert.match(main, /dev-feedback-wrong/);
  assert.match(main, /data-remove-target/);
  assert.match(main, /developer-import-config/);
  assert.match(main, /نفّذ التوصيل مباشرة فوق صفحة الكتاب/);
  assert.match(main, /audioDataUrl/);
  assert.match(main, /beginRegionSelection/);
  assert.match(viewer, /setDeveloperMode/);
  assert.match(viewer, /appendDeveloperZone/);
  assert.match(viewer, /onMatchingResult/);
  assert.match(styles, /invisible-student-zone/);
  assert.match(styles, /developer-zone-resize/);
});

test('درس المثال يضم مناطق توصيل موضوعة فوق الصور والكلمات وتعليقات للتصحيح', async () => {
  const lesson = await loadJson('lessons/sample-lesson/lesson.json');
  const matching = lesson.pages.flatMap((page) => page.activities || []).find((activity) => activity.id === 'match-fruit');
  assert.ok(matching);
  assert.ok(matching.pairs.every((pair) => pair.position && pair.position.w > 0 && pair.position.h > 0));
  assert.ok(matching.targets.every((target) => target.position && target.position.w > 0 && target.position.h > 0));
  assert.equal(Object.keys(matching.correctPairs).length, matching.pairs.length);
  assert.ok(matching.feedbackCorrect && matching.feedbackWrong);
});

test('لوحة الإدارة في الإصدار المبسّط تستخدم روابط خارجية ولا تحتاج إلى OAuth أو رفع مباشر', async () => {
  const packageJson = await loadJson('package.json');
  const managerHtml = await readText('manage.html');
  const managerJs = await readText('src/manager.js');
  const managerCss = await readText('src/manager.css');
  assert.deepEqual(packageJson.dependencies || {}, {});
  assert.deepEqual(packageJson.devDependencies || {}, {});
  assert.match(packageJson.scripts.dev, /node server\.mjs/);
  assert.match(managerHtml, /id="material-form"/);
  assert.match(managerHtml, /id="pdf-url"/);
  assert.match(managerHtml, /id="audio-urls"/);
  assert.match(managerHtml, /Google Drive API Key \(اختياري\)/);
  assert.doesNotMatch(managerHtml, /id="google-client-id"/);
  assert.doesNotMatch(managerHtml, /id="pdf-file"/);
  assert.doesNotMatch(managerHtml, /id="audio-files"/);
  assert.match(managerJs, /interactive-learning-manager-catalog/);
  assert.doesNotMatch(managerJs, /uploadType=resumable/);
  assert.doesNotMatch(managerJs, /uploadType=multipart/);
  assert.match(managerJs, /makeShortCode/);
  assert.match(managerJs, /saveCatalogLocal/);
  assert.match(managerJs, /raw\.githubusercontent\.com/);
  assert.match(managerJs, /normalizeResourceUrl/);
  assert.match(managerJs, /downloadFile\('index\.json'/);
  assert.doesNotMatch(managerJs, /loadGoogleIdentity/);
  assert.doesNotMatch(managerJs, /acquireDriveToken/);
  assert.doesNotMatch(managerJs, /publishCatalog/);
  assert.match(managerCss, /\.hierarchy-grid/);
  assert.equal(await exists('server.mjs'), true);
  assert.equal(await exists('lessons/drive-config.json'), false);
  assert.equal(await exists('vite.config.js'), false);
});

test('خدمة الدروس تقرأ الفهرس المنشور على GitHub Pages وتحتفظ بنسخة محلية للطوارئ', async () => {
  const service = await readText('src/services/lesson-service.js');
  assert.match(service, /lessons\/index\.json/);
  assert.match(service, /interactive-learning-student-catalog/);
  assert.match(service, /interactive-learning-v3-lessons/);
  assert.match(service, /indexEntry\?\.lessonData/);
  assert.doesNotMatch(service, /readRemoteCatalog/);
  assert.doesNotMatch(service, /drive-config\.json/);
});
