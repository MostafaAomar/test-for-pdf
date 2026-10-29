const CATALOG_KEY = 'interactive-learning-manager-catalog-v8';
const DRIVE_SETTINGS_KEY = 'interactive-learning-drive-settings-v8';
const DRAFT_KEY = 'interactive-learning-manager-draft-v8';
const NEW = '__new__';

const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const localized = (value) => typeof value === 'string' ? value : value?.ar || value?.en || value?.fr || '';
const localeNames = (value) => ({ ar: value, en: value, fr: value });
const asErrorMessage = (error) => String(error?.message || error || 'حدث خطأ غير متوقع.');
const looksLikeUrl = (value) => /^https?:\/\//i.test(String(value || '').trim());

let catalog = { schemaVersion: 2, subjects: [], lessons: [] };
let nextToast = 0;
let restoringDraft = false;

function readJsonStorage(key, fallback = null) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch (_) {
    return fallback;
  }
}
function writeJsonStorage(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch (error) { showToast('تعذّر حفظ البيانات في المتصفح. قد تكون مساحة التخزين ممتلئة.', 'error'); return false; }
}
function currentSettings() {
  return { apiKey: $('#google-api-key')?.value.trim() || '' };
}
function saveDriveSettings(showMessage = false) {
  const settings = currentSettings();
  writeJsonStorage(DRIVE_SETTINGS_KEY, settings);
  if (showMessage) showToast('تم حفظ المفتاح الاختياري على هذا الجهاز.', 'success');
  renderDriveStatus();
  return settings;
}
function setSaveStatus(message, dirty = false) {
  const node = $('#autosave-status');
  node.textContent = message;
  node.classList.toggle('is-dirty', dirty);
}
function showToast(message, kind = '') {
  const region = $('#toast-region');
  const id = ++nextToast;
  const toast = document.createElement('div');
  toast.className = `toast ${kind}`;
  toast.dataset.toastId = String(id);
  toast.textContent = message;
  region.append(toast);
  window.setTimeout(() => toast.remove(), 5200);
}
function setFormMessage(message, kind = '') {
  const node = $('#form-message');
  node.textContent = message;
  node.className = `form-message${kind ? ` is-${kind}` : ''}`;
}
function scheduleDraftSave() {
  if (restoringDraft) return;
  const draft = {
    subject: $('#subject-select').value,
    newSubject: $('#subject-new').value,
    grade: $('#grade-select').value,
    newGrade: $('#grade-new').value,
    unit: $('#unit-select').value,
    newUnit: $('#unit-new').value,
    title: $('#lesson-title').value,
    description: $('#lesson-description').value,
    pdfUrl: $('#pdf-url').value,
    audioUrls: $('#audio-urls').value
  };
  writeJsonStorage(DRAFT_KEY, draft);
  setSaveStatus('تم حفظ الحقول تلقائيًا');
}
function slugify(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '') || 'lesson';
}
function uniqueId(title, usedValues) {
  const used = new Set(usedValues.map((value) => String(value || '').toLowerCase()));
  const base = slugify(title);
  if (!used.has(base.toLowerCase())) return base;
  let counter = 2;
  while (used.has(`${base}-${counter}`.toLowerCase())) counter += 1;
  return `${base}-${counter}`;
}
function allIds(items) { return (items || []).map((item) => item.id); }
function makeTitle(value) { return { ar: value, en: value, fr: value }; }
function findSubject(id) { return catalog.subjects.find((item) => item.id === id) || null; }
function findGrade(subject, id) { return subject?.grades?.find((item) => item.id === id) || null; }
function findUnit(grade, id) { return grade?.units?.find((item) => item.id === id) || null; }
function allLessonIds() { return (catalog.lessons || []).map((item) => item.id); }
function makeShortCode(title) {
  const base = slugify(title).replace(/-/g, '').slice(0, 8).toUpperCase() || 'LESSON';
  const used = new Set(catalog.lessons.map((entry) => String(entry.shortCode || '').toUpperCase()));
  if (!used.has(base)) return base;
  let counter = 2;
  while (used.has(`${base.slice(0, Math.max(1, 8 - String(counter).length))}${counter}`)) counter += 1;
  return `${base.slice(0, Math.max(1, 8 - String(counter).length))}${counter}`;
}
function titleForEntry(entry) { return localized(entry.titleTranslations) || entry.title || entry.id; }
function ensureCatalogShape(value) {
  if (!value || !Array.isArray(value.subjects) || !Array.isArray(value.lessons)) return null;
  return { schemaVersion: Number(value.schemaVersion) || 2, subjects: value.subjects, lessons: value.lessons };
}

async function fetchStaticCatalog() {
  const response = await fetch('./lessons/index.json', { cache: 'no-store' });
  if (!response.ok) throw new Error(`تعذّر قراءة فهرس المواد المحلي (HTTP ${response.status}).`);
  const parsed = ensureCatalogShape(await response.json());
  if (!parsed) throw new Error('ملف lessons/index.json لا يحتوي على حقلي subjects وlessons بشكل صحيح.');
  return parsed;
}
function googleApiMediaUrl(fileId, apiKey = currentSettings().apiKey) {
  return `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&key=${encodeURIComponent(apiKey)}`;
}
async function loadInitialCatalog() {
  // Prefer a saved administrator draft so refreshing the page does not discard unsent edits.
  const saved = ensureCatalogShape(readJsonStorage(CATALOG_KEY));
  if (saved) {
    catalog = saved;
    if (saved.subjects.length) return;

    const publishedCatalog = await fetchStaticCatalog();
    catalog = { ...publishedCatalog, subjects: [...publishedCatalog.subjects, ...saved.subjects], lessons: saved.lessons };
    writeJsonStorage(CATALOG_KEY, catalog);
    return;
  }
  catalog = await fetchStaticCatalog();
  writeJsonStorage(CATALOG_KEY, catalog);
}
function saveCatalogLocal() {
  writeJsonStorage(CATALOG_KEY, catalog);
  writeJsonStorage('interactive-learning-student-catalog', catalog);
  setSaveStatus('تم حفظ التغييرات محليًا');
  renderMaterialsList();
  fetch('/api/save-catalog', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(catalog, null, 2)
  }).then((res) => {
    if (res.ok) {
      setSaveStatus('تم الحفظ في ملف index.json على القرص بنجاح');
      showToast('تم تحديث ملف lessons/index.json على القرص مباشرة بنجاح!', 'success');
    }
  }).catch(() => {});
}

function fillSelect(select, items, placeholder, selected = '') {
  const options = [`<option value="">${escapeHtml(placeholder)}</option>`];
  for (const item of items) options.push(`<option value="${escapeHtml(item.id)}">${escapeHtml(localized(item.title) || item.title || item.id)}</option>`);
  options.push(`<option value="${NEW}">＋ إضافة جديد…</option>`);
  select.innerHTML = options.join('');
  if ([...select.options].some((option) => option.value === selected)) select.value = selected;
}
function refreshSubjectOptions(selected = $('#subject-select').value) {
  fillSelect($('#subject-select'), catalog.subjects, 'اختر المادة', selected);
  updateSubjectUi(false);
}
function updateSubjectUi(resetChildren = true) {
  const value = $('#subject-select').value;
  $('#subject-new').hidden = value !== NEW;
  if (resetChildren) {
    $('#grade-select').value = '';
    $('#unit-select').value = '';
  }
  const subject = findSubject(value);
  const grades = subject?.grades || [];
  fillSelect($('#grade-select'), grades, value === NEW ? 'أضف الصف الجديد أدناه' : 'اختر الصف', value === NEW ? NEW : $('#grade-select').value);
  $('#grade-select').disabled = !value;
  if (value === NEW) $('#grade-select').value = NEW;
  updateGradeUi(resetChildren);
  scheduleDraftSave();
}
function updateGradeUi(resetChildren = true) {
  const value = $('#grade-select').value;
  $('#grade-new').hidden = value !== NEW;
  if (resetChildren) $('#unit-select').value = '';
  const subject = findSubject($('#subject-select').value);
  const grade = findGrade(subject, value);
  const units = grade?.units || [];
  fillSelect($('#unit-select'), units, value === NEW ? 'أضف الوحدة الجديدة أدناه' : 'اختر الوحدة', value === NEW ? NEW : $('#unit-select').value);
  $('#unit-select').disabled = !value;
  if (value === NEW) $('#unit-select').value = NEW;
  updateUnitUi();
  scheduleDraftSave();
}
function updateUnitUi() {
  $('#unit-new').hidden = $('#unit-select').value !== NEW;
  scheduleDraftSave();
}
function restoreDraft() {
  const draft = readJsonStorage(DRAFT_KEY);
  if (!draft) return;
  restoringDraft = true;
  $('#subject-select').value = draft.subject || '';
  $('#subject-new').value = draft.newSubject || '';
  updateSubjectUi(false);
  $('#grade-select').value = draft.grade || ($('#subject-select').value === NEW ? NEW : '');
  $('#grade-new').value = draft.newGrade || '';
  updateGradeUi(false);
  $('#unit-select').value = draft.unit || ($('#grade-select').value === NEW ? NEW : '');
  $('#unit-new').value = draft.newUnit || '';
  updateUnitUi();
  $('#lesson-title').value = draft.title || '';
  $('#lesson-description').value = draft.description || '';
  $('#pdf-url').value = draft.pdfUrl || '';
  $('#audio-urls').value = draft.audioUrls || '';
  restoringDraft = false;
  scheduleDraftSave();
}

function normalizeResourceUrl(value) {
  const url = String(value || '').trim();
  if (!url || !looksLikeUrl(url)) return url;
  const settings = currentSettings();
  let parsed;
  try { parsed = new URL(url); } catch (_) { return url; }
  // Convert a normal GitHub file page into its CORS-friendly raw file URL.
  const segments = parsed.pathname.split('/').filter(Boolean);
  if (parsed.hostname.toLowerCase() === 'github.com' && segments.length >= 5 && segments[2] === 'blob') {
    const [owner, repo, , ...filePath] = segments;
    return `https://raw.githubusercontent.com/${owner}/${repo}/${filePath.join('/')}`;
  }
  const isDriveHost = /(^|\.)drive\.google\.com$/i.test(parsed.hostname) || /(^|\.)docs\.google\.com$/i.test(parsed.hostname);
  if (!isDriveHost || !settings.apiKey) return url;
  const match = parsed.pathname.match(/\/file\/d\/([\w-]+)/) || parsed.pathname.match(/\/document\/d\/([\w-]+)/);
  const id = match?.[1] || parsed.searchParams.get('id') || '';
  return id ? googleApiMediaUrl(id, settings.apiKey) : url;
}
function renderDriveStatus() {
  const status = $('#drive-status');
  const note = $('#drive-note');
  if (!status || !note) return;
  const hasKey = Boolean(currentSettings().apiKey);
  status.textContent = hasKey ? 'تم حفظ المفتاح' : 'لا يلزم ربط';
  status.className = hasKey ? 'status-chip is-connected' : 'status-chip';
  note.textContent = hasKey
    ? 'سيستخدم التطبيق المفتاح لقراءة ملفات Drive العامة داخل عارض PDF. لا يحتاج إلى OAuth أو Client ID.'
    : 'لا يوجد تسجيل دخول أو ربط حساب. استخدم رابطًا مباشرًا يسمح بالقراءة من المتصفح. إذا كان PDF على Drive ولم يظهر داخل العارض، احفظ مفتاح Drive API الاختياري أعلاه أو استخدم رابطًا مباشرًا من مستودع ملفات يدعم CORS.';
}
function makeNewHierarchy(subjectChoice, subjectName, gradeChoice, gradeName, unitChoice, unitName) {
  let subject = findSubject(subjectChoice);
  const subjectWasNew = subjectChoice === NEW;
  if (subjectWasNew) {
    const title = subjectName.trim();
    if (!title) throw new Error('اكتب اسم المادة الجديدة.');
    subject = { id: uniqueId(title, allIds(catalog.subjects)), title: makeTitle(title), description: makeTitle(`دروس ${title}`), language: 'ar', icon: title.slice(0, 1), grades: [] };
  }
  if (!subject) throw new Error('اختر مادة صحيحة.');
  let grade = gradeChoice === NEW ? null : findGrade(subject, gradeChoice);
  if (gradeChoice === NEW || subjectWasNew) {
    const title = gradeName.trim();
    if (!title) throw new Error('اكتب اسم الصف الجديد.');
    grade = { id: uniqueId(title, allIds(subject.grades)), title: makeTitle(title), units: [] };
  }
  if (!grade) throw new Error('اختر صفًا صحيحًا.');
  let unit = unitChoice === NEW ? null : findUnit(grade, unitChoice);
  if (unitChoice === NEW || gradeChoice === NEW || subjectWasNew) {
    const title = unitName.trim();
    if (!title) throw new Error('اكتب اسم الوحدة الجديدة.');
    unit = { id: uniqueId(title, allIds(grade.units)), title: makeTitle(title) };
  }
  if (!unit) throw new Error('اختر وحدة صحيحة.');
  return {
    subject, grade, unit,
    subjectWasNew,
    gradeWasNew: gradeChoice === NEW || subjectWasNew,
    unitWasNew: unitChoice === NEW || gradeChoice === NEW || subjectWasNew
  };
}
function attachHierarchy(hierarchy) {
  if (hierarchy.subjectWasNew) catalog.subjects.push(hierarchy.subject);
  const subject = findSubject(hierarchy.subject.id);
  if (!subject.grades) subject.grades = [];
  if (hierarchy.gradeWasNew) subject.grades.push(hierarchy.grade);
  const grade = findGrade(subject, hierarchy.grade.id);
  if (!grade.units) grade.units = [];
  if (hierarchy.unitWasNew) grade.units.push(hierarchy.unit);
}
function getAudioUrlsFromForm() {
  return $('#audio-urls').value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((url) => {
    return normalizeResourceUrl(url);
  });
}
function audioActivity(audioUrl, index) {
  return {
    id: `audio-${index + 1}`,
    type: 'audio',
    title: `استمع ${index + 1}`,
    prompt: {
      ar: 'اضغط على الزر للاستماع إلى الملف الصوتي.',
      en: 'Press the button to listen to this audio file.',
      fr: 'Appuie sur le bouton pour écouter ce fichier audio.'
    },
    audio: audioUrl,
    position: { x: 5, y: Math.min(5 + index * 9, 86), w: 32, h: 7 }
  };
}
async function addMaterial(event) {
  event.preventDefault();
  const submit = $('#save-material');
  submit.disabled = true;
  submit.textContent = 'جارٍ الحفظ…';
  setFormMessage('يتم حفظ الدرس…');
  try {
    const title = $('#lesson-title').value.trim();
    if (!title) throw new Error('اكتب اسم الدرس.');
    const pdfUrlInput = $('#pdf-url').value.trim();
    if (!pdfUrlInput) throw new Error('يرجى تحديد ملف أو مسار أو رابط PDF.');
    const audioUrls = getAudioUrlsFromForm();
    const hierarchy = makeNewHierarchy(
      $('#subject-select').value, $('#subject-new').value,
      $('#grade-select').value, $('#grade-new').value,
      $('#unit-select').value, $('#unit-new').value
    );

    const lessonId = uniqueId(title, allLessonIds());
    let pdfUrl = normalizeResourceUrl(pdfUrlInput);

    // If external URL (e.g. Google Drive), download to local uploads so it works 100% without CORS
    if (/^https?:\/\//i.test(pdfUrl)) {
      setFormMessage('جارٍ فحص وتنزيل ملف PDF محليًا…');
      try {
        const dlRes = await fetch('/api/download-remote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: pdfUrl, fileName: `${lessonId}-book.pdf` })
        });
        if (dlRes.ok) {
          const dlData = await dlRes.json();
          if (dlData.localPath) pdfUrl = dlData.localPath;
        }
      } catch (_) {}
    }

    const allAudioUrls = audioUrls;
    attachHierarchy(hierarchy);
    const description = $('#lesson-description').value.trim() || `درس في ${localized(hierarchy.subject.title)} — ${title}`;
    const activities = allAudioUrls.map((url, index) => audioActivity(url, index));
    const lessonData = {
      id: lessonId,
      shortCode: makeShortCode(title),
      title,
      titleTranslations: makeTitle(title),
      language: 'ar',
      supportedLanguages: ['ar', 'en', 'fr'],
      description,
      descriptionTranslations: makeTitle(description),
      pdf: pdfUrl,
      coverImage: '',
      audioFiles: allAudioUrls,
      pages: [{ number: 1, label: 'الصفحة الأولى', activities }]
    };
    const entry = {
      id: lessonId,
      shortCode: lessonData.shortCode,
      title,
      titleTranslations: lessonData.titleTranslations,
      description,
      descriptionTranslations: lessonData.descriptionTranslations,
      subjectId: hierarchy.subject.id,
      gradeId: hierarchy.grade.id,
      unitId: hierarchy.unit.id,
      pageCount: 1,
      lessonFile: 'lessons/index.json',
      lessonData,
      source: 'manager'
    };
    catalog.lessons.push(entry);
    saveCatalogLocal();
    refreshSubjectOptions(hierarchy.subject.id);
    $('#grade-select').value = hierarchy.grade.id;
    updateGradeUi(false);
    $('#unit-select').value = hierarchy.unit.id;
    updateUnitUi();
    $('#material-form').reset();
    $('#subject-select').value = hierarchy.subject.id;
    updateSubjectUi(false);
    $('#grade-select').value = hierarchy.grade.id;
    updateGradeUi(false);
    $('#unit-select').value = hierarchy.unit.id;
    updateUnitUi();
    localStorage.removeItem(DRAFT_KEY);
    scheduleDraftSave();
    setFormMessage(`تمت إضافة «${title}» كمسودة على هذا الجهاز. نزّل الفهرس ثم ارفعه إلى GitHub ليظهر لكل الطلاب.`, 'good');
    showToast(`تمت إضافة «${title}» إلى المسودة.`, 'success');
  } catch (error) {
    setFormMessage(asErrorMessage(error), 'error');
    showToast(asErrorMessage(error), 'error');
  } finally {
    submit.disabled = false;
    submit.textContent = 'حفظ الدرس';
  }
}
function renderMaterialsList() {
  const list = $('#materials-list');
  const count = catalog.lessons.length;
  $('#material-count').textContent = `${count} درس`;
  if (!count) {
    list.innerHTML = '<div class="empty-list">لا توجد دروس بعد. أضف أول مادة من النموذج أعلاه.</div>';
    return;
  }
  const recent = [...catalog.lessons].reverse();
  list.innerHTML = recent.map((entry) => {
    const subject = findSubject(entry.subjectId);
    const grade = findGrade(subject, entry.gradeId);
    const unit = findUnit(grade, entry.unitId);
    const audioCount = entry.lessonData?.audioFiles?.length || 0;
    const hasPdf = Boolean(entry.lessonData?.pdf || entry.lessonFile);
    return `<article class="material-row" data-material-row="${escapeHtml(entry.id)}">
      <div class="material-main"><div class="material-pdf-icon">PDF</div><div>
        <div class="material-title">${escapeHtml(titleForEntry(entry))}</div>
        <div class="material-path">${escapeHtml(localized(subject?.title) || 'مادة غير معروفة')} › ${escapeHtml(localized(grade?.title) || '—')} › ${escapeHtml(localized(unit?.title) || '—')}</div>
        <div class="material-meta"><span class="meta-tag">${escapeHtml(entry.id)}</span>${audioCount ? `<span class="meta-tag">${audioCount} ملفات صوت</span>` : ''}${hasPdf ? '<span class="meta-tag">PDF</span>' : ''}${entry.source === 'manager' ? '<span class="meta-tag">أُضيف من لوحة الإدارة</span>' : ''}</div>
      </div></div>
      <div class="material-actions"><a class="icon-button" href="./index.html?lesson=${encodeURIComponent(entry.id)}" target="_blank" rel="noopener">عرض الدرس ↗</a><a class="icon-button" href="./index.html?lesson=${encodeURIComponent(entry.id)}&amp;developer=1" target="_blank" rel="noopener">تعديل التفاعلات</a><button class="icon-button danger" type="button" data-delete-material="${escapeHtml(entry.id)}">إزالة من الفهرس</button></div>
    </article>`;
  }).join('');
  list.querySelectorAll('[data-delete-material]').forEach((button) => button.addEventListener('click', () => removeMaterial(button.dataset.deleteMaterial)));
  list.querySelectorAll('a[href*="developer=1"]').forEach((link) => {
    link.addEventListener('click', () => {
      try { sessionStorage.setItem('ilp-developer-auth', '1'); } catch (_) {}
    });
  });
}
function removeMaterial(id) {
  const entry = catalog.lessons.find((item) => item.id === id);
  if (!entry) return;
  if (!window.confirm(`هل تريد إزالة «${titleForEntry(entry)}» من الفهرس؟ سيبقى الملف الأصلي على Google Drive أو GitHub كما هو.`)) return;
  catalog.lessons = catalog.lessons.filter((item) => item.id !== id);
  saveCatalogLocal();
  showToast('تمت الإزالة من المسودة. نزّل الفهرس وارفعه إلى GitHub لتطبيق التغيير على الطلاب.', 'success');
}
function downloadFile(filename, content, contentType = 'application/json;charset=utf-8') {
  const blob = new Blob([content], { type: contentType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}
function downloadCatalog() {
  downloadFile('index.json', JSON.stringify(catalog, null, 2));
  showToast('تم تنزيل index.json. ارفع هذا الملف إلى GitHub بدل lessons/index.json ليظهر التغيير لجميع الطلاب. الملفات نفسها تبقى خارج التطبيق.', 'success');
}
function clearForm() {
  $('#material-form').reset();
  $('#subject-select').value = '';
  updateSubjectUi(true);
  $('#grade-select').value = '';
  $('#unit-select').value = '';
  $('#subject-new').value = '';
  $('#grade-new').value = '';
  $('#unit-new').value = '';
  localStorage.removeItem(DRAFT_KEY);
  setFormMessage('تم مسح الحقول.');
  scheduleDraftSave();
}
function bindEvents() {
  $('#subject-select').addEventListener('change', () => updateSubjectUi(true));
  $('#grade-select').addEventListener('change', () => updateGradeUi(true));
  $('#unit-select').addEventListener('change', updateUnitUi);
  $('#material-form').addEventListener('input', (event) => {
    if (event.target.matches('#subject-new, #grade-new, #unit-new, #lesson-title, #lesson-description, #pdf-url, #audio-urls')) scheduleDraftSave();
  });
  $('#material-form').addEventListener('submit', addMaterial);
  $('#clear-form').addEventListener('click', clearForm);
  $('#save-drive-settings')?.addEventListener('click', () => saveDriveSettings(true));
  $('#google-api-key')?.addEventListener('change', () => saveDriveSettings(false));
  $('#download-catalog').addEventListener('click', downloadCatalog);
  $('#git-sync-btn')?.addEventListener('click', async () => {
    const btn = $('#git-sync-btn');
    btn.disabled = true;
    const oldText = btn.textContent;
    btn.textContent = 'جارٍ المزامنة والنشر إلى GitHub...';
    try {
      const res = await fetch('/api/git-sync', { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        showToast('✓ ' + (data.message || 'تم نشر التحديثات إلى GitHub بنجاح!'));
      } else {
        throw new Error(data.error || 'تعذّر الرفع التلقائي');
      }
    } catch (err) {
      showToast('ملاحظة: لرفع التغييرات يدويًا إلى مستودع GitHub، اكتب في موجه الأوامر:\ngit add . && git commit -m "update" && git push origin main');
    } finally {
      btn.disabled = false;
      btn.textContent = oldText;
    }
  });
  $('#pdf-file-picker')?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const info = $('#pdf-file-info');
    if (info) info.textContent = `جارٍ تجهيز ملف PDF: ${file.name}...`;

    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const fileData = String(reader.result);
        let savedUrl = '';
        try {
          const res = await fetch('/api/upload-file', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileName: file.name, fileData, subfolder: 'uploads' })
          });
          if (res.ok) {
            const data = await res.json();
            savedUrl = data.url;
          }
        } catch (_) {}

        if (savedUrl) {
          $('#pdf-url').value = savedUrl;
          if (info) info.textContent = `✓ تم حفظ الملف محليًا: ${savedUrl}`;
          showToast(`تم حفظ ملف PDF (${file.name}) بنجاح!`, 'success');
        } else {
          $('#pdf-url').value = `lessons/uploads/${file.name}`;
          if (info) info.textContent = `تم تحديد: ${file.name} (تأكد من وضعه في مجلد lessons/uploads/)`;
        }
        scheduleDraftSave();
      };
      reader.readAsDataURL(file);
    } catch (err) {
      if (info) info.textContent = 'تعذّر قراءة الملف.';
    }
  });
}

async function boot() {
  const settings = readJsonStorage(DRIVE_SETTINGS_KEY, {});
  const apiKeyField = $('#google-api-key');
  if (apiKeyField) apiKeyField.value = settings.apiKey || '';
  bindEvents();
  try {
    await loadInitialCatalog();
    refreshSubjectOptions('');
    restoreDraft();
    renderMaterialsList();
    renderDriveStatus();
    setSaveStatus('تم تحميل الفهرس؛ الحفظ التلقائي مفعّل');
  } catch (error) {
    $('#materials-list').innerHTML = `<div class="empty-list">${escapeHtml(asErrorMessage(error))}</div>`;
    showToast(asErrorMessage(error), 'error');
  }
}

boot();
