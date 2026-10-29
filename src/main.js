import { loadLessonIndex, loadLesson, findLesson, downloadLessonResources, isLessonDownloaded, lessonAssetUrl } from './services/lesson-service.js';
import { progressService } from './storage/progress-store.js';
import { syncPendingResults } from './services/sync-service.js';
import { PdfViewer } from './viewer/pdf-viewer.js';
import { openActivityDialog } from './activities/activity-renderer.js';

const root = document.querySelector('#main-content');
let lessonIndex = null;
let currentLesson = null;
let currentEntry = null;
let currentViewer = null;
let currentLang = localStorage.getItem('interactive-learning-language') || 'ar';
let resultMap = new Map();
let toastTimer = null;
let downloading = false;
let developerMode = false;
let activeDeveloperActivityId = null;
let developerUnsavedChanges = false;

const e = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const localized = (value, lang = currentLang) => typeof value === 'string' ? value : (value?.[lang] ?? value?.ar ?? value?.en ?? value?.fr ?? '');
const totalActivityCount = (lesson) => (lesson.pages || []).reduce((sum, page) => sum + (page.activities || []).length, 0);
const countLabel = (count, singular, dual = null, plural = null) => {
  if (count === 1) return `1 ${singular}`;
  if (count === 2 && dual) return `2 ${dual}`;
  return `${count} ${plural || singular}`;
};
const activityGlyph = { audio: '♫', read_aloud: '🔊', mcq: '✓', matching: '↔', text_answer: '✎', drawing: '✐' };
const subjectList = () => lessonIndex?.subjects || [];
const developerAccessEnabled = () => new URL(window.location.href).searchParams.get('developer') === '1';
const lessonConfigKey = (lessonId) => `interactive-learning-config:${lessonId}`;
const stripRuntimeLessonFields = (lesson) => {
  const { __lessonFile, __lessonUrl, __indexEntry, ...portable } = lesson || {};
  return portable;
};
function applySavedLessonConfig(lesson) {
  try {
    const raw = localStorage.getItem(lessonConfigKey(lesson.id));
    if (!raw) return lesson;
    const override = JSON.parse(raw);
    if (override?.id !== lesson.id || !Array.isArray(override.pages)) return lesson;
    return { ...lesson, ...override, __lessonFile: lesson.__lessonFile, __lessonUrl: lesson.__lessonUrl, __indexEntry: lesson.__indexEntry };
  } catch (error) {
    console.warn('Could not read lesson configuration override:', error);
    return lesson;
  }
}
function downloadJsonFile(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
function markDeveloperDirty() {
  developerUnsavedChanges = true;
  const badge = document.querySelector('#developer-unsaved');
  if (badge) { badge.textContent = 'توجد تغييرات غير محفوظة'; badge.classList.add('is-dirty'); }
}
function markDeveloperSaved() {
  developerUnsavedChanges = false;
  const badge = document.querySelector('#developer-unsaved');
  if (badge) { badge.textContent = 'تم حفظ الإعدادات'; badge.classList.remove('is-dirty'); }
}
function activeLessonPage(pageNumber = currentViewer?.currentPage || 1) {
  return currentLesson?.pages?.find((page) => Number(page.number) === Number(pageNumber));
}
function getDeveloperActivity(id = activeDeveloperActivityId) {
  return currentLesson?.pages?.flatMap((page) => page.activities || []).find((activity) => activity.id === id) || null;
}
function selectDeveloperActivity(activity) {
  if (!activity) return;
  activeDeveloperActivityId = activity.id;
  const inspector = document.querySelector('#developer-inspector');
  if (!inspector) return;
  inspector.hidden = false;
  const title = inspector.querySelector('[name="dev-title"]');
  const prompt = inspector.querySelector('[name="dev-prompt"]');
  const explanation = inspector.querySelector('[name="dev-explanation"]');
  const audioPath = inspector.querySelector('[name="dev-audio-path"]');
  const studentVisible = inspector.querySelector('[name="dev-student-visible"]');
  const studentVisibleLabel = inspector.querySelector('.developer-check');
  const readText = inspector.querySelector('[name="dev-read-text"]');
  const choices = inspector.querySelector('[name="dev-choices"]');
  const correctAnswer = inspector.querySelector('[name="dev-correct-answer"]');
  const expectedAnswers = inspector.querySelector('[name="dev-expected-answers"]');
  const correctFeedback = inspector.querySelector('[name="dev-feedback-correct"]');
  const wrongFeedback = inspector.querySelector('[name="dev-feedback-wrong"]');
  const audioFields = inspector.querySelectorAll('.dev-audio-only');
  const readFields = inspector.querySelectorAll('.dev-read-only');
  const mcqFields = inspector.querySelectorAll('.dev-mcq-only');
  const textFields = inspector.querySelectorAll('.dev-text-only');
  const matchingFields = inspector.querySelectorAll('.dev-matching-only');
  title.value = activity.title || '';
  prompt.value = localized(activity.prompt, 'ar');
  explanation.value = localized(activity.explanation, 'ar');
  audioPath.value = activity.audio || '';
  studentVisible.checked = activity.studentVisible !== false;
  if (studentVisibleLabel) studentVisibleLabel.hidden = activity.type === 'matching';
  readText.value = localized(activity.text, 'ar');
  choices.value = (activity.choices || []).map((choice) => `${choice.id}|${localized(choice.label, 'ar')}`).join('\n');
  correctAnswer.value = activity.correctAnswer || '';
  expectedAnswers.value = (activity.expectedAnswers || []).join(', ');
  correctFeedback.value = localized(activity.feedbackCorrect, 'ar');
  wrongFeedback.value = localized(activity.feedbackWrong, 'ar');
  audioFields.forEach((el) => { el.hidden = activity.type !== 'audio'; });
  readFields.forEach((el) => { el.hidden = activity.type !== 'read_aloud'; });
  mcqFields.forEach((el) => { el.hidden = activity.type !== 'mcq'; });
  textFields.forEach((el) => { el.hidden = activity.type !== 'text_answer'; });
  matchingFields.forEach((el) => { el.hidden = activity.type !== 'matching'; });
  const audioStatus = inspector.querySelector('#dev-audio-status');
  if (audioStatus) audioStatus.textContent = activity.audioDataUrl ? 'يوجد ملف صوت مضمّن في الإعدادات' : (activity.audio ? `المسار الحالي: ${activity.audio}` : 'لم تتم إضافة ملف صوت بعد');
  const matchingManager = document.querySelector('#developer-matching-manager');
  if (matchingManager) matchingManager.hidden = activity.type !== 'matching';
  renderDeveloperMatchingManager(activity);
  const selected = document.querySelector('#developer-selected-name');
  if (selected) selected.textContent = `${activity.title || activity.id} · ${activity.type}`;
}
function renderDeveloperMatchingManager(activity = getDeveloperActivity()) {
  const manager = document.querySelector('#developer-matching-manager');
  if (!manager) return;
  if (!activity || activity.type !== 'matching') { manager.hidden = true; manager.innerHTML = ''; return; }
  manager.hidden = false;
  const targets = activity.targets || [];
  manager.innerHTML = `<div class="developer-inspector-grid">
      <label class="full-width">اسم العنصر الذي ستضيفه
        <input type="text" id="dev-endpoint-label" placeholder="مثال: book أو الحقيبة" maxlength="140">
      </label>
    </div>
    <div class="developer-controls" style="margin-top:8px">
      <button class="button button-secondary button-small" type="button" id="dev-add-source">＋ تحديد كلمة/صورة في جهة البداية</button>
      <button class="button button-secondary button-small" type="button" id="dev-add-target">＋ تحديد كلمة/صورة في جهة الهدف</button>
    </div>
    <p class="field-help">اكتب الاسم، ثم اختر إضافة نقطة، واسحب مستطيلًا فوق الكلمة أو الصورة في الصفحة. حرّك المستطيلات بعد ذلك بالسحب.</p>
    <div class="developer-mapping">${(activity.pairs || []).map((pair) => `<div class="developer-mapping-row"><input type="text" data-source-label="${e(pair.id)}" value="${e(localized(pair.left, 'ar') || pair.id)}" aria-label="تسمية نقطة البداية"><select data-match-pair="${e(pair.id)}" aria-label="اختر الهدف الصحيح لـ ${e(localized(pair.left, 'ar') || pair.id)}"><option value="">اختر الهدف الصحيح…</option>${targets.map((target) => `<option value="${e(target.id)}" ${activity.correctPairs?.[pair.id] === target.id ? 'selected' : ''}>${e(typeof target.label === 'string' ? target.label : localized(target.label, 'ar'))}</option>`).join('')}</select><button class="button button-danger button-small" type="button" data-remove-source="${e(pair.id)}">حذف</button></div>`).join('') || '<p class="field-help">لم تتم إضافة نقاط بداية حتى الآن.</p>'}</div>
    <div class="developer-mapping developer-target-list">${targets.map((target) => `<div class="developer-mapping-row"><input type="text" data-target-label="${e(target.id)}" value="${e(typeof target.label === 'string' ? target.label : localized(target.label, 'ar'))}" aria-label="تسمية الهدف"><span>هدف</span><button class="button button-danger button-small" type="button" data-remove-target="${e(target.id)}">حذف</button></div>`).join('') || '<p class="field-help">لم تتم إضافة أهداف حتى الآن.</p>'}</div>
    <p class="field-help">النقاط المضافة: ${(activity.pairs || []).length} بداية، ${targets.length} هدف.</p>`;
  manager.querySelector('#dev-add-source')?.addEventListener('click', () => addMatchingEndpoint('source'));
  manager.querySelector('#dev-add-target')?.addEventListener('click', () => addMatchingEndpoint('target'));
  manager.querySelectorAll('[data-source-label]').forEach((input) => input.addEventListener('change', () => {
    const pair = (activity.pairs || []).find((item) => item.id === input.dataset.sourceLabel);
    if (!pair) return;
    pair.left = { ar: input.value.trim(), en: input.value.trim(), fr: input.value.trim() };
    markDeveloperDirty(); currentViewer?.refreshMarkers();
  }));
  manager.querySelectorAll('[data-target-label]').forEach((input) => input.addEventListener('change', () => {
    const target = (activity.targets || []).find((item) => item.id === input.dataset.targetLabel);
    if (!target) return;
    target.label = input.value.trim();
    markDeveloperDirty(); renderDeveloperMatchingManager(activity); currentViewer?.refreshMarkers();
  }));
  manager.querySelectorAll('[data-remove-source]').forEach((button) => button.addEventListener('click', () => {
    const pairId = button.dataset.removeSource;
    activity.pairs = (activity.pairs || []).filter((pair) => pair.id !== pairId);
    if (activity.correctPairs) delete activity.correctPairs[pairId];
    markDeveloperDirty(); renderDeveloperMatchingManager(activity); currentViewer?.refreshMarkers();
  }));
  manager.querySelectorAll('[data-remove-target]').forEach((button) => button.addEventListener('click', () => {
    const targetId = button.dataset.removeTarget;
    activity.targets = (activity.targets || []).filter((target) => target.id !== targetId);
    for (const [pairId, value] of Object.entries(activity.correctPairs || {})) if (value === targetId) delete activity.correctPairs[pairId];
    markDeveloperDirty(); renderDeveloperMatchingManager(activity); currentViewer?.refreshMarkers();
  }));
  manager.querySelectorAll('[data-match-pair]').forEach((select) => select.addEventListener('change', () => {
    activity.correctPairs ||= {};
    if (select.value) activity.correctPairs[select.dataset.matchPair] = select.value;
    else delete activity.correctPairs[select.dataset.matchPair];
    markDeveloperDirty();
    currentViewer?.refreshMarkers();
  }));
}
function addMatchingEndpoint(kind) {
  const activity = getDeveloperActivity();
  if (!activity || activity.type !== 'matching' || !currentViewer) { toast('اختر نشاط توصيل أولًا بالنقر على مستطيله في وضع المطوّر.'); return; }
  const labelInput = document.querySelector('#dev-endpoint-label');
  const label = labelInput?.value.trim();
  if (!label) { toast('اكتب اسم الكلمة أو الصورة أولًا.'); labelInput?.focus(); return; }
  currentViewer.beginRegionSelection((position) => {
    if (kind === 'source') {
      const id = `source-${(activity.pairs || []).length + 1}`;
      activity.pairs ||= [];
      activity.pairs.push({ id, left: { ar: label, en: label, fr: label }, position });
      activity.correctPairs ||= {};
    } else {
      const id = `target-${(activity.targets || []).length + 1}`;
      activity.targets ||= [];
      activity.targets.push({ id, label, position });
    }
    if (labelInput) labelInput.value = '';
    markDeveloperDirty();
    renderDeveloperMatchingManager(activity);
    currentViewer.refreshMarkers();
    toast(kind === 'source' ? 'أُضيفت نقطة البداية. عيّن هدفها الصحيح من قائمة المطابقة.' : 'أُضيفت نقطة الهدف. عُد إلى نقاط البداية لتحديد الإجابات الصحيحة.');
  }, { label: kind === 'source' ? 'اسحب مستطيلًا حول الكلمة أو الصورة (بداية التوصيل)' : 'اسحب مستطيلًا حول الكلمة أو الصورة (هدف التوصيل)' });
}
function saveDeveloperInspector() {
  const activity = getDeveloperActivity();
  const inspector = document.querySelector('#developer-inspector');
  if (!activity || !inspector) return;
  activity.title = inspector.querySelector('[name="dev-title"]').value.trim() || activity.id;
  const promptText = inspector.querySelector('[name="dev-prompt"]').value.trim();
  activity.prompt = { ar: promptText, en: promptText, fr: promptText };
  const explanationText = inspector.querySelector('[name="dev-explanation"]').value.trim();
  activity.explanation = { ar: explanationText, en: explanationText, fr: explanationText };
  if (activity.type !== 'matching') activity.studentVisible = inspector.querySelector('[name="dev-student-visible"]').checked;
  if (activity.type === 'audio') {
    activity.audio = inspector.querySelector('[name="dev-audio-path"]').value.trim();
    const status = inspector.querySelector('#dev-audio-status');
    if (status && activity.audioDataUrl) status.textContent = 'يوجد ملف صوت مضمّن في الإعدادات';
  }
  if (activity.type === 'read_aloud') {
    const textValue = inspector.querySelector('[name="dev-read-text"]').value;
    activity.text = { ar: textValue, en: textValue, fr: textValue };
  }
  if (activity.type === 'mcq') {
    activity.choices = inspector.querySelector('[name="dev-choices"]').value.split('\n').map((line, index) => {
      const [rawId, ...labelParts] = line.split('|');
      const label = labelParts.join('|').trim() || rawId.trim();
      const id = rawId.trim() || `choice-${index + 1}`;
      return { id, label: { ar: label, en: label, fr: label } };
    }).filter((item) => item.label.ar);
    activity.correctAnswer = inspector.querySelector('[name="dev-correct-answer"]').value.trim();
  }
  if (activity.type === 'matching') {
    const correct = inspector.querySelector('[name="dev-feedback-correct"]').value.trim();
    const wrong = inspector.querySelector('[name="dev-feedback-wrong"]').value.trim();
    activity.feedbackCorrect = { ar: correct, en: correct, fr: correct };
    activity.feedbackWrong = { ar: wrong, en: wrong, fr: wrong };
  }
  if (activity.type === 'text_answer') {
    activity.expectedAnswers = inspector.querySelector('[name="dev-expected-answers"]').value.split(',').map((answer) => answer.trim()).filter(Boolean);
  }
  currentViewer?.refreshMarkers();
  renderPageActivities(currentViewer?.currentPage || 1);
  const selected = document.querySelector('#developer-selected-name');
  if (selected) selected.textContent = `${activity.title} · ${activity.type}`;
  markDeveloperDirty();
  toast('تم تحديث بيانات النشاط في الذاكرة. اضغط «حفظ الإعدادات» لحفظها على الجهاز.');
}
function wireDeveloperTools() {
  const toggle = document.querySelector('#developer-toggle');
  const panel = document.querySelector('#developer-panel');
  if (!toggle || !panel) return;
  toggle.addEventListener('click', () => {
    developerMode = !developerMode;
    panel.hidden = !developerMode;
    toggle.textContent = developerMode ? '✓ وضع المطوّر مفعّل' : '⚙ وضع المطوّر';
    currentViewer?.setDeveloperMode(developerMode);
    if (!developerMode) document.querySelector('#developer-inspector').hidden = true;
  });
  document.querySelector('#developer-add-region')?.addEventListener('click', () => {
    const type = document.querySelector('#developer-new-type')?.value || 'audio';
    currentViewer?.beginRegionSelection((position) => {
      const page = activeLessonPage();
      if (!page) return;
      const typeNames = { audio: 'زر تشغيل صوت', read_aloud: 'قراءة صوتية', matching: 'نشاط توصيل', mcq: 'سؤال اختيار من متعدد', text_answer: 'إجابة نصية', drawing: 'رسم وتعليق' };
      const id = `teacher-${type}-${Date.now().toString(36)}`;
      const title = typeNames[type] || 'نشاط جديد';
      const activity = {
        id, type, title,
        prompt: { ar: 'اتبع التعليمات ثم نفّذ النشاط.', en: 'Follow the instructions and complete the activity.', fr: 'Suis les consignes puis réalise l’activité.' },
        explanation: { ar: 'راجع الإجابة وحاول مرة أخرى عند الحاجة.', en: 'Review your answer and try again if needed.', fr: 'Vérifie ta réponse et réessaie si nécessaire.' },
        position, studentVisible: type === 'audio', centerButton: type === 'audio'
      };
      if (type === 'audio') { activity.audio = ''; }
      if (type === 'read_aloud') activity.text = { ar: 'اكتب النص هنا', en: 'Add text here', fr: 'Ajoute le texte ici' };
      if (type === 'mcq') { activity.choices = [{ id: 'option-a', label: { ar: 'الخيار الأول', en: 'Option A', fr: 'Option A' } }, { id: 'option-b', label: { ar: 'الخيار الثاني', en: 'Option B', fr: 'Option B' } }]; activity.correctAnswer = 'option-a'; }
      if (type === 'text_answer') activity.expectedAnswers = [];
      if (type === 'matching') { activity.pairs = []; activity.targets = []; activity.correctPairs = {}; activity.feedbackCorrect = 'أحسنت!'; activity.feedbackWrong = 'حاول مرة أخرى.'; }
      page.activities ||= [];
      page.activities.push(activity);
      markDeveloperDirty();
      selectDeveloperActivity(activity);
      currentViewer?.refreshMarkers();
      renderPageActivities(currentViewer?.currentPage || 1);
      toast('أُضيفت المنطقة. اضبط بيانات النشاط ثم احفظ الإعدادات.');
    }, { label: 'اسحب مستطيلًا فوق المكان الذي تريد إضافة التفاعل إليه' });
  });
  document.querySelector('#developer-save-activity')?.addEventListener('click', saveDeveloperInspector);
  document.querySelector('#developer-delete-activity')?.addEventListener('click', () => {
    const activity = getDeveloperActivity();
    if (!activity || !window.confirm('هل تريد حذف هذا النشاط من الدرس؟')) return;
    for (const page of currentLesson.pages || []) page.activities = (page.activities || []).filter((item) => item.id !== activity.id);
    activeDeveloperActivityId = null;
    document.querySelector('#developer-inspector').hidden = true;
    currentViewer?.refreshMarkers();
    renderPageActivities(currentViewer?.currentPage || 1);
    markDeveloperDirty();
    toast('حُذف النشاط من الإعدادات الحالية. اضغط حفظ الإعدادات لتثبيت الحذف.');
  });
  document.querySelector('#dev-clear-audio')?.addEventListener('click', () => {
    const activity = getDeveloperActivity();
    if (!activity || activity.type !== 'audio') return;
    delete activity.audioDataUrl;
    activity.audio = '';
    const pathInput = document.querySelector('[name="dev-audio-path"]');
    if (pathInput) pathInput.value = '';
    const status = document.querySelector('#dev-audio-status');
    if (status) status.textContent = 'تمت إزالة الملف الصوتي';
    markDeveloperDirty(); currentViewer?.refreshMarkers();
  });
  document.querySelector('#developer-save-config')?.addEventListener('click', () => {
    saveDeveloperInspectorIfDirty();
    try {
      const portable = stripRuntimeLessonFields(currentLesson);
      localStorage.setItem(lessonConfigKey(currentLesson.id), JSON.stringify(portable));
      markDeveloperSaved();
      toast('حُفظت إعدادات الدرس على هذا الجهاز. نزّل ملف JSON لنقل الإعدادات إلى جهاز أو خادم آخر.');
    } catch (error) {
      toast('تعذّر الحفظ المحلي (قد تكون الملفات الصوتية كبيرة). استخدم «تنزيل ملف الدرس JSON» لحفظ الإعدادات في ملف.');
    }
  });
  document.querySelector('#developer-export-config')?.addEventListener('click', () => {
    saveDeveloperInspectorIfDirty();
    const portable = stripRuntimeLessonFields(currentLesson);
    downloadJsonFile(`${currentLesson.id}.lesson.json`, portable);
    toast('بدأ تنزيل ملف إعدادات الدرس. احتفظ به مع ملف PDF ومجلد الأصول.');
  });
  document.querySelector('#developer-import-config')?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const imported = JSON.parse(await file.text());
      if (imported.id !== currentLesson.id || !Array.isArray(imported.pages)) throw new Error('هذا الملف لا يخص الدرس المفتوح أو لا يحتوي صفحات صالحة.');
      currentLesson = { ...currentLesson, ...imported, __lessonFile: currentLesson.__lessonFile, __lessonUrl: currentLesson.__lessonUrl, __indexEntry: currentLesson.__indexEntry };
      currentViewer.lesson = currentLesson;
      activeDeveloperActivityId = null;
      const inspector = document.querySelector('#developer-inspector');
      if (inspector) inspector.hidden = true;
      currentViewer.refreshMarkers();
      renderPageActivities(currentViewer.currentPage);
      markDeveloperDirty();
      toast('تم استيراد الإعدادات. اضغط «حفظ الإعدادات» لتثبيتها على هذا الجهاز.');
    } catch (error) { toast(error.message || 'تعذّر قراءة ملف الإعدادات.'); }
    event.target.value = '';
  });
  document.querySelector('#dev-audio-file')?.addEventListener('change', async (event) => {
    const activity = getDeveloperActivity();
    const file = event.target.files?.[0];
    if (!file || !activity) return;
    if (!file.type.startsWith('audio/')) { toast('اختر ملفًا صوتيًا مثل MP3 أو WAV أو M4A.'); event.target.value = ''; return; }
    try {
      activity.audioDataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('تعذّر قراءة الملف الصوتي.')); reader.readAsDataURL(file);
      });
      activity.audioFileName = file.name;
      const status = document.querySelector('#dev-audio-status');
      if (status) status.textContent = `الملف المضمّن: ${file.name} (${Math.round(file.size / 1024)} KB)`;
      markDeveloperDirty();
      currentViewer?.refreshMarkers();
      toast('تم إرفاق الملف الصوتي داخل إعدادات النشاط. احفظ إعدادات الدرس.');
    } catch (error) { toast(error.message); }
    event.target.value = '';
  });
}
function saveDeveloperInspectorIfDirty() {
  const inspector = document.querySelector('#developer-inspector');
  if (inspector && !inspector.hidden && getDeveloperActivity()) saveDeveloperInspector();
}


// The interface remains Arabic/RTL regardless of the language of a PDF lesson.
function setDirection() {
  document.documentElement.lang = 'ar';
  document.documentElement.dir = 'rtl';
}

function headerMarkup() {
  return `<header class="site-header">
    <div class="brand"><div class="brand-mark" aria-hidden="true">✿</div><div><h1 class="brand-title">تعلّم تفاعلي</h1><p class="brand-subtitle">اختر المادة، ثم الصف والوحدة والدرس</p></div></div>
    <div class="header-actions"><span class="connection-pill" id="connectionPill"><span class="connection-dot"></span><span id="connectionText">متصل</span></span></div>
  </header>`;
}

function updateConnectionState() {
  const pill = document.querySelector('#connectionPill');
  const text = document.querySelector('#connectionText');
  if (!pill || !text) return;
  pill.classList.toggle('offline', !navigator.onLine);
  text.textContent = navigator.onLine ? 'متصل' : 'دون اتصال';
}

function toast(message) {
  let region = document.querySelector('.toast-region');
  if (!region) {
    region = document.createElement('div');
    region.className = 'toast-region';
    region.setAttribute('role', 'status');
    region.setAttribute('aria-live', 'polite');
    document.body.append(region);
  }
  region.innerHTML = `<div class="toast-message">${e(message)}</div>`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => region.remove(), 3800);
}

function setAppContent(html) {
  root.innerHTML = html;
  setDirection();
  updateConnectionState();
}

async function getAllResults() {
  try { return await progressService.getAllResults(); } catch (_) { return []; }
}

function currentBrowseState() {
  const url = new URL(window.location.href);
  return {
    subjectId: url.searchParams.get('subject') || '',
    gradeId: url.searchParams.get('grade') || '',
    unitId: url.searchParams.get('unit') || ''
  };
}

function applyBrowseUrl(state, { push = true } = {}) {
  const url = new URL(window.location.href);
  for (const key of ['subject', 'grade', 'unit', 'lesson', 'code']) url.searchParams.delete(key);
  if (state.subjectId) url.searchParams.set('subject', state.subjectId);
  if (state.gradeId) url.searchParams.set('grade', state.gradeId);
  if (state.unitId) url.searchParams.set('unit', state.unitId);
  if (push) history.pushState({}, '', url);
  else history.replaceState({}, '', url);
}

async function navigateBrowse(state) {
  applyBrowseUrl(state, { push: true });
  await renderHome();
}

function catalogCard({ id, title, description = '', kind, icon = '•', meta = '', demo = false, isNew = false }) {
  const dataAttr = kind === 'subject' ? 'data-subject-id' : kind === 'grade' ? 'data-grade-id' : kind === 'unit' ? 'data-unit-id' : 'data-open-lesson';
  const newBadge = (!demo && isNew) ? `<span class="new-badge">جديد ✨</span>` : '';
  return `<button class="catalog-card ${kind === 'lesson' ? 'catalog-lesson-card' : ''}" type="button" ${dataAttr}="${e(id)}">
    <span class="catalog-icon" aria-hidden="true">${e(icon)}</span>
    <span class="catalog-card-copy"><strong>${e(title)}${newBadge}</strong>${description ? `<span>${e(description)}</span>` : ''}<small>${e(meta)}${demo ? `${meta ? ' · ' : ''}مثال تجريبي` : ''}</small></span>
    <span class="catalog-arrow" aria-hidden="true">←</span>
  </button>`;
}

function breadcrumbMarkup(state, subject, grade, unit) {
  const crumbs = [`<button type="button" data-breadcrumb="home">المواد</button>`];
  if (subject) crumbs.push(`<span class="crumb-separator">›</span><button type="button" data-breadcrumb="subject">${e(localized(subject.title))}</button>`);
  if (grade) crumbs.push(`<span class="crumb-separator">›</span><button type="button" data-breadcrumb="grade">${e(localized(grade.title))}</button>`);
  if (unit) crumbs.push(`<span class="crumb-separator">›</span><span class="crumb-current">${e(localized(unit.title))}</span>`);
  return `<nav class="breadcrumbs" aria-label="مسار التصفح">${crumbs.join('')}</nav>`;
}

async function renderHome({ error = '' } = {}) {
  if (currentViewer) { currentViewer.destroy(); currentViewer = null; }
  currentLesson = null;
  currentEntry = null;

  const state = currentBrowseState();
  const subject = subjectList().find((item) => item.id === state.subjectId) || null;
  const grade = subject?.grades?.find((item) => item.id === state.gradeId) || null;
  const unit = grade?.units?.find((item) => item.id === state.unitId) || null;

  // Remove stale hierarchy values from manually edited or old links.
  const cleanedState = {
    subjectId: subject?.id || '',
    gradeId: grade?.id || '',
    unitId: unit?.id || ''
  };
  if (cleanedState.subjectId !== state.subjectId || cleanedState.gradeId !== state.gradeId || cleanedState.unitId !== state.unitId) {
    applyBrowseUrl(cleanedState, { push: false });
  }

  let heading = 'اختر المادة';
  let intro = 'ابدأ بالمادة التي تريد دراستها، ثم اختر الصف والوحدة والدرس.';
  let cards = '';
  let countLabelText = countLabel(subjectList().length, 'مادة', 'مادتان', 'مواد');
  let emptyText = '';
  let subjectForBreadcrumb = subject;
  let gradeForBreadcrumb = grade;

  if (!subject) {
    cards = subjectList().map((item) => catalogCard({
      id: item.id,
      kind: 'subject',
      title: localized(item.title),
      description: localized(item.description),
      icon: item.icon || '📘',
      meta: countLabel(item.grades?.length || 0, 'صف', 'صفّان', 'صفوف')
    })).join('');
  } else if (!grade) {
    heading = `اختر الصف — ${localized(subject.title)}`;
    intro = 'بعد اختيار الصف ستظهر الوحدات الموجودة في المنهاج.';
    cards = (subject.grades || []).map((item) => catalogCard({
      id: item.id,
      kind: 'grade',
      title: localized(item.title),
      description: localized(item.description || { ar: 'افتح الصف لاستعراض وحداته.' }),
      icon: '🎓',
      meta: countLabel(item.units?.length || 0, 'وحدة', 'وحدتان', 'وحدات')
    })).join('');
    countLabelText = countLabel(subject.grades?.length || 0, 'صف', 'صفّان', 'صفوف');
  } else if (!unit) {
    heading = `اختر الوحدة — ${localized(grade.title)}`;
    intro = 'اختر الوحدة الأولى أو الثانية أو الثالثة لعرض دروسها فقط.';
    cards = (grade.units || []).map((item) => {
      const lessonCount = (lessonIndex?.lessons || []).filter((entry) => entry.subjectId === subject.id && entry.gradeId === grade.id && entry.unitId === item.id).length;
      return catalogCard({
        id: item.id,
        kind: 'unit',
        title: localized(item.title),
        description: localized(item.description || { ar: 'افتح الوحدة لعرض الدروس المتاحة.' }),
        icon: '▤',
        meta: countLabel(lessonCount, 'درس', 'درسان', 'دروس')
      });
    }).join('');
    countLabelText = countLabel(grade.units?.length || 0, 'وحدة', 'وحدتان', 'وحدات');
  } else {
    heading = `دروس ${localized(unit.title)}`;
    intro = `المادة: ${localized(subject.title)} · الصف: ${localized(grade.title)}. افتح الدرس لعرض PDF بوضوح.`;
    const unitLessons = (lessonIndex?.lessons || []).filter((entry) => entry.subjectId === subject.id && entry.gradeId === grade.id && entry.unitId === unit.id);
    cards = unitLessons.map((entry) => catalogCard({
      id: entry.id,
      kind: 'lesson',
      title: localized(entry.titleTranslations) || entry.title,
      description: localized(entry.descriptionTranslations) || entry.description,
      icon: 'PDF',
      meta: `${Number(entry.pageCount) || '—'} صفحات`,
      demo: Boolean(entry.demo),
      isNew: Boolean(entry.isNew)
    })).join('');
    countLabelText = countLabel(unitLessons.length, 'درس', 'درسان', 'دروس');
    if (!unitLessons.length) emptyText = 'لا توجد دروس مضافة إلى هذه الوحدة بعد. أضف ملفات PDF والصوت إلى مجلد الدرس ثم سجّل الدرس في lessons/index.json.';
  }

  const breadcrumbs = breadcrumbMarkup(state, subjectForBreadcrumb, gradeForBreadcrumb, unit);
  const homeBack = subject ? `<button class="back-catalog-button" type="button" id="catalog-back">← رجوع</button>` : '';
  setAppContent(`${headerMarkup()}
    <section class="catalog-page">
      ${breadcrumbs}
      <div class="catalog-heading-row"><div><h2>${e(heading)}</h2><p>${e(intro)}</p></div><span class="catalog-count">${e(countLabelText)}</span></div>
      ${error ? `<div class="notice notice-error" role="alert">${e(error)} <button class="button button-secondary button-small" id="retry-index" type="button">إعادة المحاولة</button></div>` : ''}
      ${cards ? `<div class="catalog-grid">${cards}</div>` : `<div class="empty-state"><strong>${e(emptyText || 'لا توجد عناصر للعرض.')}</strong></div>`}
      ${homeBack}
      <p class="catalog-help">لا تحتاج إلى تسجيل دخول. تقدّم الطالب وأعماله محفوظة على الجهاز نفسه.</p>
    </section>`);

  root.querySelectorAll('[data-subject-id]').forEach((button) => button.addEventListener('click', () => navigateBrowse({ subjectId: button.dataset.subjectId })));
  root.querySelectorAll('[data-grade-id]').forEach((button) => button.addEventListener('click', () => navigateBrowse({ subjectId: subject.id, gradeId: button.dataset.gradeId })));
  root.querySelectorAll('[data-unit-id]').forEach((button) => button.addEventListener('click', () => navigateBrowse({ subjectId: subject.id, gradeId: grade.id, unitId: button.dataset.unitId })));
  root.querySelectorAll('[data-open-lesson]').forEach((button) => {
    button.addEventListener('click', () => {
      const entry = findLesson(lessonIndex, button.dataset.openLesson);
      if (entry) openLesson(entry, true);
    });
  });
  root.querySelectorAll('[data-breadcrumb]').forEach((button) => button.addEventListener('click', () => {
    const target = button.dataset.breadcrumb;
    if (target === 'home') return navigateBrowse({});
    if (target === 'subject') return navigateBrowse({ subjectId: subject?.id || '' });
    if (target === 'grade') return navigateBrowse({ subjectId: subject?.id || '', gradeId: grade?.id || '' });
  }));
  document.querySelector('#catalog-back')?.addEventListener('click', () => {
    if (unit) return navigateBrowse({ subjectId: subject.id, gradeId: grade.id });
    if (grade) return navigateBrowse({ subjectId: subject.id });
    return navigateBrowse({});
  });
  document.querySelector('#retry-index')?.addEventListener('click', async () => {
    try { lessonIndex = await loadLessonIndex(); await renderHome(); }
    catch (err) { await renderHome({ error: err.message }); }
  });
}

function lessonMarkup(lesson) {
  const title = localized(lesson.titleTranslations) || lesson.title;
  const description = localized(lesson.descriptionTranslations) || lesson.description;
  const total = totalActivityCount(lesson);
  const pdfUrl = lessonAssetUrl(lesson, lesson.pdf);
  const state = currentBrowseState();
  const subject = subjectList().find((item) => item.id === state.subjectId);
  const grade = subject?.grades?.find((item) => item.id === state.gradeId);
  const unit = grade?.units?.find((item) => item.id === state.unitId);
  const where = [subject && localized(subject.title), grade && localized(grade.title), unit && localized(unit.title)].filter(Boolean).join(' › ');
  return `<header class="lesson-header">
      <div class="lesson-title-block">
        <button class="breadcrumb-button" id="back-to-unit" type="button">← العودة إلى دروس الوحدة</button>
        <div class="lesson-context">${e(where || 'الدرس')}</div>
        <h1>${e(title)}</h1><p>${e(description || '')}</p>
      </div>
      <div class="lesson-header-controls">
        <label class="language-picker" for="lesson-language">لغة الأنشطة <select id="lesson-language" aria-label="اختر لغة الأنشطة">${[['ar','العربية'],['en','English'],['fr','Français']].map(([val,label])=>`<option value="${val}" ${currentLang === val ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
        <a class="button button-secondary" href="${e(pdfUrl)}" target="_blank" rel="noopener">فتح PDF منفصل ↗</a>
        <button type="button" class="button button-primary" id="download-lesson">↓ تنزيل دون إنترنت</button>
        ${developerAccessEnabled() ? '<button type="button" class="button developer-access-button" id="developer-toggle">⚙ وضع المطوّر</button>' : ''}
      </div>
    </header>
    ${developerAccessEnabled() ? `<section class="developer-panel" id="developer-panel" hidden>
      <div class="developer-panel-heading"><div><strong>استوديو إعداد التفاعلات</strong><p>اسحب المناطق فوق الصفحة، حرّك المستطيلات، ثم احفظ الإعدادات أو نزّلها. أدوات التحرير لا تظهر في رابط الطالب العادي.</p></div><span id="developer-unsaved">لا توجد تغييرات غير محفوظة</span></div>
      <div class="developer-controls">
        <label>نوع التفاعل الجديد<select id="developer-new-type"><option value="audio">زر تشغيل ملف صوتي</option><option value="matching">نشاط توصيل بخطوط</option><option value="mcq">سؤال اختيار من متعدد</option><option value="text_answer">إجابة كتابية</option><option value="read_aloud">قراءة صوتية للنص</option><option value="drawing">رسم وتعليق</option></select></label>
        <button class="button button-primary" type="button" id="developer-add-region">＋ أضف منطقة بالسحب</button>
        <button class="button button-secondary" type="button" id="developer-save-config">حفظ الإعدادات</button>
        <button class="button button-secondary" type="button" id="developer-export-config">تنزيل ملف الدرس JSON</button>
        <label>استيراد إعدادات محفوظة<input class="developer-file-input" id="developer-import-config" type="file" accept=".json,application/json"></label>
      </div>
      <section class="developer-inspector" id="developer-inspector" hidden>
        <div class="developer-panel-heading"><div><strong>بيانات النشاط المحدد</strong><p id="developer-selected-name">لم يتم اختيار نشاط</p></div></div>
        <div class="developer-inspector-grid">
          <label>العنوان<input type="text" name="dev-title" maxlength="160"></label>
          <label>التعليمات<textarea name="dev-prompt" rows="2"></textarea></label>
          <label class="full-width">تعليق عام أو شرح الإجابة<textarea name="dev-explanation" rows="2"></textarea></label>
          <label class="dev-matching-only full-width" hidden>رسالة عند التوصيل الصحيح<textarea name="dev-feedback-correct" rows="2"></textarea></label>
          <label class="dev-matching-only full-width" hidden>رسالة عند التوصيل الخاطئ<textarea name="dev-feedback-wrong" rows="2"></textarea></label>
          <label class="dev-audio-only full-width" hidden>مسار ملف الصوت (اختياري)<input type="text" name="dev-audio-path" placeholder="audio/lesson.mp3"><small id="dev-audio-status">لم تتم إضافة ملف صوت بعد</small></label>
          <label class="dev-audio-only full-width" hidden>أو أرفق ملفًا صوتيًا — سيتم تضمينه في ملف الإعدادات<input class="developer-file-input" id="dev-audio-file" type="file" accept="audio/*"></label>
          <label class="dev-read-only full-width" hidden>النص المطلوب قراءته<textarea name="dev-read-text" rows="2"></textarea></label>
          <label class="dev-mcq-only full-width" hidden>الاختيارات، خيار في كل سطر بهذا الشكل: id|نص الخيار<textarea name="dev-choices" rows="3"></textarea></label>
          <label class="dev-mcq-only" hidden>معرّف الخيار الصحيح<input type="text" name="dev-correct-answer"></label>
          <label class="dev-text-only full-width" hidden>الإجابات المقبولة، افصل بينها بفاصلة<input type="text" name="dev-expected-answers" placeholder="book, the book"></label>
          <label class="developer-check full-width"><input type="checkbox" name="dev-student-visible" checked> أظهر زرًا مرئيًا للطالب (ألغِ الخيار لجعل المنطقة شفافة)</label>
        </div>
        <div class="developer-controls" style="margin-top:10px"><button class="button button-primary" type="button" id="developer-save-activity">تحديث بيانات النشاط</button><button class="button button-danger" type="button" id="developer-delete-activity">حذف النشاط</button><button class="button button-ghost dev-audio-only" type="button" id="dev-clear-audio" hidden>إزالة ملف الصوت</button></div>
        <section class="developer-mapping" id="developer-matching-manager" hidden></section>
      </section>
    </section>` : ''}
    <div id="offline-notice" class="notice notice-info" hidden role="status"></div>
    <main class="reader-main">
      <section class="reader-tools" aria-label="أدوات ملف PDF">
        <div class="reader-page-navigation"><button class="button button-ghost button-icon" id="page-prev" type="button" aria-label="الصفحة السابقة">‹</button><span class="page-counter" id="page-counter">صفحة 1 من ${lesson.pages.length}</span><button class="button button-ghost button-icon" id="page-next" type="button" aria-label="الصفحة التالية">›</button></div>
        <div class="reader-zoom-tools"><button class="button button-ghost button-icon" id="zoom-out" type="button" aria-label="تصغير">−</button><button class="button button-ghost button-small" id="zoom-reset" type="button">ملاءمة الصفحة</button><button class="button button-ghost button-icon" id="zoom-in" type="button" aria-label="تكبير">+</button><button class="button button-secondary button-small" id="page-annotate" type="button">✎ ارسم واكتب على الصفحة</button></div>
        <span class="reader-progress" id="lesson-progress">0 من ${total} نشاط مكتمل</span>
      </section>
      <section class="pdf-panel" aria-label="صفحة الدرس من ملف PDF"><div id="pdf-viewer-mount"></div></section>
      <section class="page-activities-section" aria-live="polite">
        <div class="page-activities-heading"><div><h2 id="page-activities-title">أنشطة هذه الصفحة</h2><p id="page-activities-description">اقرأ التعليمات الموجودة في ملف الدرس، ثم اختر النشاط عند الحاجة.</p></div></div>
        <div class="page-activities" id="page-activities"><div class="activities-empty">سيظهر هنا ما يخص الصفحة الحالية.</div></div>
      </section>
    </main>
    <footer class="reader-footer">تُحفظ النتائج على هذا الجهاز فقط. استخدم «تنزيل دون إنترنت» لحفظ ملف PDF والصوت قبل انقطاع الشبكة.</footer>`;
}

function renderPageActivities(pageNumber = 1) {
  const mount = document.querySelector('#page-activities');
  const title = document.querySelector('#page-activities-title');
  const description = document.querySelector('#page-activities-description');
  if (!mount || !currentLesson) return;
  const page = (currentLesson.pages || []).find((item) => Number(item.number) === Number(pageNumber));
  const activities = page?.activities || [];
  if (title) title.textContent = `أنشطة الصفحة ${pageNumber}`;
  if (description) description.textContent = activities.length ? 'استخدم الأزرار الصغيرة فوق الصفحة لتشغيل الصوت أو فتح النشاط، أو اختر نشاطًا من القائمة أدناه.' : 'اتبع تعليمات ملف PDF. لا توجد أنشطة رقمية إضافية لهذه الصفحة.';
  if (!activities.length) {
    mount.innerHTML = `<div class="activities-empty">لا توجد أنشطة إضافية لهذه الصفحة. تابع ما يطلبه ملف PDF.</div>`;
    return;
  }
  mount.innerHTML = activities.map((activity) => {
    const result = resultMap.get(activity.id);
    const prompt = localized(activity.prompt);
    return `<button type="button" class="page-activity-button${result?.completed ? ' done' : ''}" data-activity-id="${e(activity.id)}" data-page-number="${Number(pageNumber)}">
      <span class="page-activity-icon" aria-hidden="true">${activityGlyph[activity.type] || '•'}</span>
      <span class="page-activity-copy"><strong>${e(activity.title)}</strong>${prompt ? `<span>${e(prompt)}</span>` : ''}</span>
      <span class="page-activity-state">${result?.completed ? '✓ أُنجز' : 'ابدأ ←'}</span>
    </button>`;
  }).join('');
  mount.querySelectorAll('[data-activity-id]').forEach((button) => button.addEventListener('click', () => {
    const activity = activities.find((item) => item.id === button.dataset.activityId);
    if (activity) openActivity(activity, Number(button.dataset.pageNumber));
  }));
}

async function refreshProgress() {
  if (!currentLesson) return;
  const results = await progressService.getResultsForLesson(currentLesson.id);
  resultMap = new Map(results.map((result) => [result.activityId, result]));
  const lessonActivityIds = new Set((currentLesson.pages || []).flatMap((page) => (page.activities || []).map((activity) => activity.id)));
  const done = results.filter((result) => result.completed && lessonActivityIds.has(result.activityId)).length;
  const total = totalActivityCount(currentLesson);
  const progress = document.querySelector('#lesson-progress');
  if (progress) progress.textContent = `${done} من ${total} نشاط مكتمل`;
  currentViewer?.refreshMarkers();
  renderPageActivities(currentViewer?.currentPage || 1);
}

async function refreshDownloadedStatus() {
  if (!currentLesson || !currentEntry) return;
  const downloaded = await isLessonDownloaded(currentEntry, currentLesson);
  const button = document.querySelector('#download-lesson');
  const notice = document.querySelector('#offline-notice');
  if (button) button.textContent = downloaded ? '✓ جاهز دون إنترنت' : '↓ تنزيل دون إنترنت';
  if (notice) {
    notice.hidden = navigator.onLine || downloaded;
    notice.textContent = 'هذا الدرس غير محفوظ كاملًا على الجهاز بعد. اتصل بالإنترنت واضغط «تنزيل دون إنترنت» قبل محاولة استخدامه دون اتصال.';
  }
}

async function openActivity(activity, pageNumber) {
  if (!currentLesson || !currentViewer) return;
  if (activity.type === 'matching' && ((activity.pairs || []).some((pair) => pair.position) || (activity.targets || []).some((target) => target.position))) {
    if (currentViewer.currentPage !== pageNumber) await currentViewer.goToPage(pageNumber);
    toast('نفّذ التوصيل مباشرة فوق صفحة الكتاب: اضغط على الصورة أو الكلمة أولًا، ثم اضغط على المطابقة.');
    return;
  }
  if (currentViewer.currentPage !== pageNumber) await currentViewer.goToPage(pageNumber);
  const saved = resultMap.get(activity.id) || await progressService.getResult(currentLesson.id, activity.id);
  openActivityDialog({
    activity,
    lesson: currentLesson,
    language: currentLang,
    saved,
    progressService,
    viewer: currentViewer,
    onSaved: refreshProgress,
    onToast: toast
  });
}

async function openLesson(entry, pushState = false) {
  developerMode = false;
  activeDeveloperActivityId = null;
  developerUnsavedChanges = false;
  if (currentViewer) { currentViewer.destroy(); currentViewer = null; }
  downloading = false;
  const url = new URL(window.location.href);
  url.searchParams.delete('code');
  url.searchParams.set('lesson', entry.id);
  // A direct lesson URL still knows the catalogue path when the index has that metadata.
  if (entry.subjectId && !url.searchParams.get('subject')) url.searchParams.set('subject', entry.subjectId);
  if (entry.gradeId && !url.searchParams.get('grade')) url.searchParams.set('grade', entry.gradeId);
  if (entry.unitId && !url.searchParams.get('unit')) url.searchParams.set('unit', entry.unitId);
  if (pushState) history.pushState({ lesson: entry.id }, '', url);
  else history.replaceState({ lesson: entry.id }, '', url);

  root.innerHTML = '<div class="boot-state"><span class="spinner" aria-hidden="true"></span><p>جارٍ فتح الدرس…</p></div>';
  try {
    const loadedLesson = await loadLesson(entry);
    const lesson = applySavedLessonConfig(loadedLesson);
    currentLesson = lesson;
    currentEntry = entry;
    const results = await progressService.getResultsForLesson(lesson.id);
    resultMap = new Map(results.map((result) => [result.activityId, result]));
    setAppContent(lessonMarkup(lesson));

    document.querySelector('#back-to-unit').addEventListener('click', async () => {
      const browse = currentBrowseState();
      delete browse.lessonId;
      applyBrowseUrl(browse, { push: true });
      await renderHome();
    });

    document.querySelector('#lesson-language').addEventListener('change', (event) => {
      currentLang = event.target.value;
      localStorage.setItem('interactive-learning-language', currentLang);
      const title = document.querySelector('.lesson-title-block h1');
      const desc = document.querySelector('.lesson-title-block p');
      if (title) title.textContent = localized(currentLesson.titleTranslations) || currentLesson.title;
      if (desc) desc.textContent = localized(currentLesson.descriptionTranslations) || currentLesson.description;
      renderPageActivities(currentViewer?.currentPage || 1);
      toast(`تم اختيار لغة الأنشطة: ${event.target.selectedOptions[0].textContent}`);
    });

    currentViewer = new PdfViewer(document.querySelector('#pdf-viewer-mount'), lesson, {
      onActivate: (activity, pageNo) => openActivity(activity, pageNo),
      onPageChange: ({ currentPage, pageCount }) => {
        const counter = document.querySelector('#page-counter');
        if (counter) counter.textContent = `صفحة ${currentPage} من ${pageCount}`;
        const prev = document.querySelector('#page-prev');
        const next = document.querySelector('#page-next');
        if (prev) prev.disabled = currentPage <= 1;
        if (next) next.disabled = currentPage >= pageCount;
        renderPageActivities(currentPage);
        if (developerMode && activeDeveloperActivityId) {
          const pageActivities = activeLessonPage(currentPage)?.activities || [];
          if (!pageActivities.some((activity) => activity.id === activeDeveloperActivityId)) {
            activeDeveloperActivityId = null;
            const inspector = document.querySelector('#developer-inspector');
            if (inspector) inspector.hidden = true;
          }
        }
      },
      onToast: toast,
      onDeveloperSelect: (activity) => selectDeveloperActivity(activity),
      onDeveloperDirty: markDeveloperDirty,
      onMatchingResult: async (activity, matchResult) => {
        try {
          await progressService.saveResult({
            lessonId: lesson.id, activityId: activity.id, completed: matchResult.completed,
            answer: matchResult.answer, isCorrect: matchResult.isCorrect, score: matchResult.score
          });
          await refreshProgress();
        } catch (_) { toast('تم رسم خط التوصيل، لكن تعذّر حفظ النتيجة.'); }
      },
      onAudioPlayed: async (activity) => {
        try {
          await progressService.saveResult({
            lessonId: lesson.id, activityId: activity.id, completed: true,
            answer: { played: true, audio: activity.audio || activity.audioDataUrl || '' }, isCorrect: null, score: null
          });
          await refreshProgress();
        } catch (_) { toast('اشتغل الصوت، لكن تعذّر حفظ تقدّم الاستماع.'); }
      },
      getResult: (activityId) => resultMap.get(activityId),
      getLanguage: () => currentLang
    });
    try { await currentViewer.load(); }
    catch (_) { /* The viewer displays a helpful error state. */ }
    wireDeveloperTools();

    document.querySelector('#page-prev').addEventListener('click', () => currentViewer?.goToPage(currentViewer.currentPage - 1));
    document.querySelector('#page-next').addEventListener('click', () => currentViewer?.goToPage(currentViewer.currentPage + 1));
    document.querySelector('#zoom-in').addEventListener('click', () => currentViewer?.zoomBy(.15));
    document.querySelector('#zoom-out').addEventListener('click', () => currentViewer?.zoomBy(-.15));
    document.querySelector('#zoom-reset').addEventListener('click', () => currentViewer?.resetZoom());
    document.querySelector('#page-annotate').addEventListener('click', async () => {
      if (!currentViewer || !currentLesson) return;
      const pageNumber = currentViewer.currentPage;
      const activityId = `__page-annotation-${pageNumber}`;
      const previous = await progressService.getResult(currentLesson.id, activityId);
      currentViewer.startAnnotation({
        activity: { id: activityId, type: 'drawing', title: `الرسم والكتابة على الصفحة ${pageNumber}` },
        initialWork: previous?.studentWork || null,
        onSave: async (studentWork) => {
          await progressService.saveResult({
            lessonId: currentLesson.id, activityId, completed: true,
            answer: null, isCorrect: null, score: null, studentWork
          });
          toast('تم حفظ الرسم والكتابة على هذه الصفحة على الجهاز.');
        }
      });
    });

    document.querySelector('#download-lesson').addEventListener('click', async () => {
      if (downloading) return;
      downloading = true;
      const button = document.querySelector('#download-lesson');
      button.disabled = true;
      button.textContent = 'جارٍ التنزيل…';
      try {
        const result = await downloadLessonResources(currentEntry, currentLesson, ({ completed, total }) => {
          button.textContent = `جارٍ التنزيل ${completed}/${total}`;
        });
        await refreshDownloadedStatus();
        if (result.ready) toast(`اكتمل تنزيل الدرس (${result.total} ملفًا). يمكنك الآن فتحه دون اتصال.`);
        else toast(`نُزّل ${result.completed} من ${result.total} ملفًا. اتصل بالإنترنت وأعد المحاولة لإكمال التنزيل.`);
      } catch (error) {
        toast(`تعذّر التنزيل: ${error.message || 'تحقق من الاتصال ثم أعد المحاولة.'}`);
      } finally {
        downloading = false;
        if (button) button.disabled = false;
        await refreshDownloadedStatus();
      }
    });

    await refreshProgress();
    await refreshDownloadedStatus();
  } catch (error) {
    setAppContent(`${headerMarkup()}<section class="catalog-page"><div class="notice notice-error" role="alert"><strong>تعذّر فتح الدرس.</strong><br>${e(error.message || 'خطأ غير معروف')}<p>تحقق من أن ملف JSON وملف PDF موجودان في مجلد الدرس.</p><button class="button button-primary" id="error-back-home" type="button">العودة إلى المواد</button></div></section>`);
    document.querySelector('#error-back-home')?.addEventListener('click', () => {
      applyBrowseUrl({}, { push: true });
      renderHome();
    });
  }
}

async function routeFromUrl() {
  if (!lessonIndex) return renderHome();
  const url = new URL(window.location.href);
  const lessonQuery = url.searchParams.get('lesson');
  const codeQuery = url.searchParams.get('code');
  const desired = lessonQuery ? findLesson(lessonIndex, lessonQuery) : codeQuery ? findLesson(lessonIndex, codeQuery) : null;
  if (desired) return openLesson(desired, false);
  if (lessonQuery || codeQuery) {
    history.replaceState({}, '', './');
    await renderHome({ error: 'رمز الدرس أو معرّفه غير معروف. اختر المادة والوحدة ثم افتح الدرس.' });
    return;
  }
  return renderHome();
}

function showPasscodeGate(accessControl) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'passcode-overlay';
    overlay.innerHTML = `
      <div class="passcode-card">
        <div class="passcode-logo">✿</div>
        <h1>تعلّم تفاعلي</h1>
        <p>أدخل رمز الدخول للمتابعة</p>
        <input type="password" class="passcode-input" id="passcode-input" placeholder="رمز الدخول..." autocomplete="off">
        <p class="passcode-hint" id="passcode-hint">${accessControl.hint || ''}</p>
        <p class="passcode-error" id="passcode-error" hidden>رمز خاطئ. حاول مرة أخرى.</p>
        <button class="button button-primary passcode-btn" type="button" id="passcode-submit">دخول</button>
      </div>`;
    document.body.appendChild(overlay);

    const input = overlay.querySelector('#passcode-input');
    const errorEl = overlay.querySelector('#passcode-error');
    const btn = overlay.querySelector('#passcode-submit');

    function attempt() {
      const entered = input.value.trim();
      if (entered === accessControl.passcode) {
        try { localStorage.setItem('ilp-access-granted', '1'); } catch (_) {}
        overlay.remove();
        resolve();
      } else {
        errorEl.hidden = false;
        input.value = '';
        input.focus();
      }
    }

    btn.addEventListener('click', attempt);
    input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') attempt(); });
    input.focus();
  });
}

async function boot() {
  setDirection();
  try {
    lessonIndex = await loadLessonIndex();

    // Access control gate
    const ac = lessonIndex.accessControl;
    if (ac && ac.enabled === true) {
      const granted = localStorage.getItem('ilp-access-granted') === '1';
      if (!granted) {
        await showPasscodeGate(ac);
      }
    }

    await routeFromUrl();
  } catch (error) {
    lessonIndex = { subjects: [], lessons: [] };
    await renderHome({ error: error.message || 'تعذّر تحميل فهرس المواد.' });
  }
  if (location.protocol.startsWith('http') && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register(new URL('./sw.js', document.baseURI).href).catch((error) => console.warn('PWA registration failed:', error));
  }
  window.addEventListener('online', () => { updateConnectionState(); syncPendingResults().catch(() => {}); refreshDownloadedStatus(); });
  window.addEventListener('offline', () => { updateConnectionState(); refreshDownloadedStatus(); });
  window.addEventListener('popstate', () => routeFromUrl());
}

boot();
