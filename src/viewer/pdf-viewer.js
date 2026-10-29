import { lessonAssetUrl } from '../services/lesson-service.js';

const ACTIVITY_META = {
  audio: { icon: '♫', short: 'صوت' },
  read_aloud: { icon: '🔊', short: 'استمع' },
  mcq: { icon: '✓', short: 'سؤال' },
  matching: { icon: '↔', short: 'توصيل' },
  text_answer: { icon: '✎', short: 'اكتب' },
  drawing: { icon: '✐', short: 'ارسم' }
};

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

export class PdfViewer {
  constructor(mount, lesson, { onActivate, onPageChange, onToast, onAudioPlayed, onMatchingResult, onDeveloperSelect, onDeveloperDirty, getResult, getLanguage }) {
    this.mount = mount;
    this.lesson = lesson;
    this.onActivate = onActivate;
    this.onPageChange = onPageChange;
    this.onToast = onToast;
    this.onAudioPlayed = onAudioPlayed;
    this.onMatchingResult = onMatchingResult;
    this.onDeveloperSelect = onDeveloperSelect;
    this.onDeveloperDirty = onDeveloperDirty;
    this.getResult = getResult;
    this.getLanguage = getLanguage;
    this.currentPage = 1;
    this.zoom = 1;
    this.pdf = null;
    this.pdfjs = null;
    this.renderTask = null;
    this.mode = 'loading';
    this.annotation = null;
    this.markerAudio = null;
    this.markerAudioButton = null;
    this.markerAudioActivityId = null;
    this.resizeObserver = null;
    this.renderToken = 0;
    this.developerMode = false;
    this.regionSelection = null;
    this.selectedMatchSource = null;
    this.buildShell();
    this.resizeObserver = new ResizeObserver(() => {
      if (this.mode !== 'loading' && !this.annotation) this.renderPage(this.currentPage);
    });
    this.resizeObserver.observe(this.frame);
  }

  buildShell() {
    this.mount.innerHTML = `
      <div class="pdf-frame" id="pdfFrame" aria-label="صفحة ملف PDF">
        <div class="pdf-page-stage" id="pdfPageStage"><div class="viewer-error">جارٍ تحميل ملف الدرس…</div></div>
      </div>
      <p class="viewer-fallback-note" id="viewerFallbackNote" hidden></p>`;
    this.frame = this.mount.querySelector('#pdfFrame');
    this.stage = this.mount.querySelector('#pdfPageStage');
    this.fallbackNote = this.mount.querySelector('#viewerFallbackNote');
  }

  async load() {
    const pdfUrl = lessonAssetUrl(this.lesson, this.lesson.pdf);
    try {
      // Use the standalone ES module build: no npm install or bundler is needed.
      // Keep the worker version pinned to the same PDF.js release.
      const pdfjsVersion = '4.10.38';
      this.pdfjs = await import(`https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsVersion}/pdf.min.mjs`);
      this.pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsVersion}/pdf.worker.min.mjs`;
      this.pdf = await this.pdfjs.getDocument({ url: pdfUrl, useSystemFonts: true, disableFontFace: false }).promise;
      this.mode = 'pdfjs';
      this.fallbackNote.hidden = true;
    } catch (error) {
      const hasPreviewPages = (this.lesson.pages || []).every((page) => Boolean(page.previewImage));
      if (!hasPreviewPages) {
        this.mode = 'error';
        this.stage.innerHTML = `<div class="viewer-error"><strong>تعذّر عرض ملف PDF.</strong><br>تأكد من اتصال الإنترنت لتحميل مكتبة PDF.js. إذا كنت تستخدم رابط Google Drive، تأكد من أنه رابط تنزيل مباشر (uc?export=download) لا رابط مشاركة. للوصول دون إنترنت، انقر «تنزيل دون إنترنت» أثناء اتصالك بالشبكة أولًا. <a href="${escapeHtml(pdfUrl)}" target="_blank" rel="noopener">فتح ملف PDF مباشرة</a></div>`;
        throw error;
      }
      this.mode = 'image-fallback';
      this.fallbackNote.hidden = false;
      this.fallbackNote.textContent = 'يعرض التطبيق صور معاينة محلية واضحة لأن عارض PDF لم يُحمّل. تأكد من وجود صورة معاينة لكل صفحة؛ يظل ملف PDF الأصلي متاحًا للفتح والتنزيل.';
    }
    await this.renderPage(1);
    return { mode: this.mode, pageCount: this.pageCount() };
  }

  pageCount() {
    return this.pdf?.numPages || this.lesson.pages?.length || 1;
  }

  getPageData(pageNumber = this.currentPage) {
    return (this.lesson.pages || []).find((page) => Number(page.number) === Number(pageNumber)) || { number: pageNumber, activities: [] };
  }

  async renderPage(pageNumber) {
    if (this.annotation) return;
    const page = Math.max(1, Math.min(this.pageCount(), Number(pageNumber) || 1));
    this.currentPage = page;
    const token = ++this.renderToken;
    if (this.renderTask) {
      try { this.renderTask.cancel(); } catch (_) {}
      this.renderTask = null;
    }
    this.stage.innerHTML = '';
    this.stage.style.position = 'relative';
    this.stage.style.width = 'min(100%, 760px)';
    this.stage.style.height = 'auto';

    const pageData = this.getPageData(page);
    // Use a provided page preview first. It avoids browser-specific font substitution
    // and keeps the textbook's printed text and illustrations exactly as prepared.
    if (pageData.previewImage) {
      const image = document.createElement('img');
      image.alt = `صفحة الكتاب ${page}`;
      image.decoding = 'async';
      image.style.width = `${Math.min(Math.max(260, this.frame.clientWidth - 18), 900) * this.zoom}px`;
      image.style.height = 'auto';
      image.style.maxWidth = 'none';
      await new Promise((resolve) => {
        image.onload = resolve;
        image.onerror = resolve;
        image.src = lessonAssetUrl(this.lesson, pageData.previewImage);
        // Cached images can be complete before handlers observe a load event.
        if (image.complete) resolve();
      });
      if (token !== this.renderToken) return;
      if (image.naturalWidth > 0) {
        const renderedWidth = parseFloat(image.style.width);
        this.stage.style.width = `${renderedWidth}px`;
        this.stage.style.height = `${renderedWidth * (image.naturalHeight / Math.max(1, image.naturalWidth) || 1.294)}px`;
        this.stage.innerHTML = '';
        this.stage.append(image);
      } else if (this.mode === 'pdfjs' && this.pdf) {
        await this.renderPdfCanvas(page, token);
      } else {
        this.stage.innerHTML = '<div class="viewer-error">تعذّر تحميل صورة المعاينة وملف PDF غير متاح للعرض.</div>';
      }
    } else if (this.mode === 'pdfjs' && this.pdf) {
      await this.renderPdfCanvas(page, token);
    } else {
      this.mode = 'error';
      this.stage.innerHTML = `<div class="viewer-error"><strong>لا توجد صورة معاينة لهذه الصفحة، وتعذّر عرض PDF.</strong><br><a href="${escapeHtml(lessonAssetUrl(this.lesson, this.lesson.pdf))}" target="_blank" rel="noopener">فتح ملف PDF مباشرة</a></div>`;
    }

    if (token !== this.renderToken) return;
    this.refreshMarkers();
    this.onPageChange({ currentPage: this.currentPage, pageCount: this.pageCount(), activities: this.getPageData().activities || [] });
  }

  async renderPdfCanvas(pageNumber, token) {
    if (!this.pdf || !this.pdfjs) return;
    try {
      const pdfPage = await this.pdf.getPage(pageNumber);
      if (token !== this.renderToken) return;
      const unitViewport = pdfPage.getViewport({ scale: 1 });
      const availableWidth = Math.max(260, this.frame.clientWidth - 18);
      const fitScale = Math.min(availableWidth / unitViewport.width, 1.5);
      const scale = fitScale * this.zoom;
      const viewport = pdfPage.getViewport({ scale });
      const outputScale = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d', { alpha: false });
      canvas.width = Math.floor(viewport.width * outputScale);
      canvas.height = Math.floor(viewport.height * outputScale);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      this.stage.style.width = `${viewport.width}px`;
      this.stage.style.height = `${viewport.height}px`;
      this.stage.innerHTML = '';
      this.stage.append(canvas);
      this.renderTask = pdfPage.render({
        canvasContext: context,
        viewport,
        transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null,
        intent: 'display'
      });
      await this.renderTask.promise;
      if (token !== this.renderToken) return;
    } catch (error) {
      if (error?.name !== 'RenderingCancelledException') console.warn('PDF rendering issue:', error);
      if (token !== this.renderToken) return;
    }
  }

  finishPageRender(token) {
    if (token !== this.renderToken) return;
    this.refreshMarkers();
    this.onPageChange({ currentPage: this.currentPage, pageCount: this.pageCount(), activities: this.getPageData().activities || [] });
  }

  async goToPage(page) { return this.renderPage(page); }
  refreshMarkers() {
    if (!this.stage || this.annotation) return;
    this.stage.querySelector('.activity-marker-layer')?.remove();
    this.stage.querySelector('.developer-layer')?.remove();
    this.stage.querySelector('.region-selection-surface')?.remove();
    const activities = this.getPageData().activities || [];
    if (this.developerMode) {
      this.renderDeveloperLayer(activities);
      return;
    }
    const layer = document.createElement('div');
    layer.className = 'activity-marker-layer';
    layer.setAttribute('aria-label', 'مناطق التفاعل في صفحة الكتاب');
    let hasItems = false;
    for (const activity of activities) {
      const overlayMatching = activity.type === 'matching' && (
        (activity.pairs || []).some((pair) => pair.position) || (activity.targets || []).some((target) => target.position)
      );
      if (overlayMatching) {
        hasItems = true;
        this.renderStudentMatching(layer, activity);
        continue;
      }
      if (!activity.position || !Number.isFinite(Number(activity.position.x)) || !Number.isFinite(Number(activity.position.y))) continue;
      hasItems = true;
      const button = document.createElement('button');
      const result = this.getResult?.(activity.id);
      const glyph = ({ audio: '▶', read_aloud: '🔊', mcq: '✓', matching: '↔', text_answer: '✎', drawing: '✐' })[activity.type] || '•';
      const invisible = activity.studentVisible === false;
      button.type = 'button';
      button.dataset.activityId = activity.id;
      button.className = `activity-marker activity-marker--${activity.type || 'other'}${result?.completed ? ' done' : ''}${invisible ? ' invisible-student-zone' : ''}`;
      const markerX = Number(activity.position.x) || 0;
      const markerY = Number(activity.position.y) || 0;
      const centerVisibleMarker = activity.centerButton && !invisible;
      button.style.left = `${Math.max(0, Math.min(99, markerX + (centerVisibleMarker ? Number(activity.position.w || 0) / 2 : 0)))}%`;
      button.style.top = `${Math.max(0, Math.min(99, markerY + (centerVisibleMarker ? Number(activity.position.h || 0) / 2 : 0)))}%`;
      if (activity.centerButton && !invisible) button.style.transform = 'translate(-50%, -50%)';
      if (invisible) {
        button.style.width = `${Math.max(1, Math.min(100, Number(activity.position.w) || 8))}%`;
        button.style.height = `${Math.max(1, Math.min(100, Number(activity.position.h) || 6))}%`;
      }
      button.setAttribute('aria-label', `${activity.title || 'نشاط'}${activity.type === 'audio' ? ' — تشغيل الصوت' : ''}`);
      button.title = invisible ? (activity.title || 'منطقة تفاعل') : (activity.title || 'فتح النشاط');
      button.innerHTML = `<span class="marker-icon" aria-hidden="true">${invisible ? '' : glyph}</span><span class="marker-done" aria-hidden="true">${result?.completed ? '✓' : ''}</span>`;
      if (activity.type === 'audio' && this.markerAudioActivityId === activity.id && this.markerAudio && !this.markerAudio.paused) {
        button.classList.add('playing');
        if (!invisible) button.innerHTML = '<span class="marker-icon" aria-hidden="true">Ⅱ</span><span class="marker-done" aria-hidden="true"></span>';
        button.setAttribute('aria-label', `${activity.title || 'الصوت'} — إيقاف الصوت`);
        this.markerAudioButton = button;
      }
      button.addEventListener('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (activity.type === 'audio' && (activity.audio || activity.audioDataUrl)) {
          await this.toggleMarkerAudio(activity, button);
          return;
        }
        this.onActivate?.(activity, this.currentPage);
      });
      layer.append(button);
    }
    if (hasItems) this.stage.append(layer);
  }

  renderStudentMatching(layer, activity) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('matching-overlay-svg');
    svg.setAttribute('viewBox', '0 0 1000 1000');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('aria-hidden', 'true');
    const saved = this.getResult?.(activity.id);
    const matches = saved?.answer?.matches || saved?.answer || {};
    const sources = activity.pairs || [];
    const targets = activity.targets || [];
    for (const pair of sources) {
      const targetId = matches[pair.id];
      const target = targets.find((item) => item.id === targetId);
      if (!pair.position || !target?.position) continue;
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', String((Number(pair.position.x) + Number(pair.position.w || 0) / 2) * 10));
      line.setAttribute('y1', String((Number(pair.position.y) + Number(pair.position.h || 0) / 2) * 10));
      line.setAttribute('x2', String((Number(target.position.x) + Number(target.position.w || 0) / 2) * 10));
      line.setAttribute('y2', String((Number(target.position.y) + Number(target.position.h || 0) / 2) * 10));
      const correct = (activity.correctPairs || {})[pair.id] === target.id;
      line.setAttribute('class', `matching-line ${correct ? 'is-correct' : 'is-wrong'}`);
      svg.append(line);
    }
    layer.append(svg);
    for (const pair of sources) {
      if (!pair.position) continue;
      const btn = this.createMatchingHotspot(activity, 'source', pair.id, pair.position, pair.left);
      layer.append(btn);
    }
    for (const target of targets) {
      if (!target.position) continue;
      const btn = this.createMatchingHotspot(activity, 'target', target.id, target.position, target.label);
      layer.append(btn);
    }
  }

  createMatchingHotspot(activity, kind, id, position, label) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `matching-hotspot matching-hotspot--${kind}${this.selectedMatchSource?.activityId === activity.id && this.selectedMatchSource?.pairId === id ? ' selected' : ''}`;
    button.style.left = `${Number(position.x) || 0}%`;
    button.style.top = `${Number(position.y) || 0}%`;
    button.style.width = `${Math.max(1, Number(position.w) || 5)}%`;
    button.style.height = `${Math.max(1, Number(position.h) || 5)}%`;
    const textLabel = typeof label === 'string' ? label : (label?.[this.getLanguage?.() || 'ar'] || label?.ar || label?.en || 'نقطة توصيل');
    button.setAttribute('aria-label', `${kind === 'source' ? 'نقطة البداية' : 'نقطة الهدف'}: ${textLabel}`);
    button.title = `${kind === 'source' ? 'ابدأ التوصيل من' : 'أكمل التوصيل إلى'} ${textLabel}`;
    button.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (kind === 'source') {
        this.selectedMatchSource = { activityId: activity.id, pairId: id };
        this.refreshMarkers();
        this.onToast?.('تم تحديد نقطة البداية. اضغط على الكلمة أو الصورة المطابقة لإكمال الخط.');
        return;
      }
      const selected = this.selectedMatchSource;
      if (!selected || selected.activityId !== activity.id) {
        this.onToast?.('ابدأ بالنقر على الكلمة أو الصورة التي تريد توصيلها أولًا.');
        return;
      }
      const pair = (activity.pairs || []).find((item) => item.id === selected.pairId);
      if (!pair) { this.selectedMatchSource = null; this.refreshMarkers(); return; }
      const resultMap = { ...(this.getResult?.(activity.id)?.answer?.matches || this.getResult?.(activity.id)?.answer || {}) };
      resultMap[pair.id] = id;
      const correct = (activity.correctPairs || {})[pair.id] === id;
      this.selectedMatchSource = null;
      const total = (activity.pairs || []).length;
      const correctCount = (activity.pairs || []).filter((item) => resultMap[item.id] && resultMap[item.id] === (activity.correctPairs || {})[item.id]).length;
      const complete = total > 0 && (activity.pairs || []).every((item) => Boolean(resultMap[item.id]));
      const allCorrect = complete && correctCount === total;
      const currentLang = this.getLanguage?.() || 'ar';
      const correctFeedback = typeof activity.feedbackCorrect === 'string' ? activity.feedbackCorrect : (activity.feedbackCorrect?.[currentLang] || activity.feedbackCorrect?.ar || 'أحسنت، هذا هو التوصيل الصحيح.');
      const wrongFeedback = typeof activity.feedbackWrong === 'string' ? activity.feedbackWrong : (activity.feedbackWrong?.[currentLang] || activity.feedbackWrong?.ar || 'حاول مرة أخرى، وابحث عن المطابقة المناسبة.');
      this.onToast?.(correct ? `صحيح! ${correctFeedback}` : `هذا التوصيل غير صحيح. ${wrongFeedback}`);
      await this.onMatchingResult?.(activity, {
        answer: resultMap, isCorrect: complete ? allCorrect : null,
        score: total ? correctCount / total : 0, completed: complete,
        lastPairId: pair.id, lastTargetId: id, lastCorrect: correct
      });
      this.refreshMarkers();
    });
    return button;
  }

  renderDeveloperLayer(activities) {
    const layer = document.createElement('div');
    layer.className = 'developer-layer';
    layer.setAttribute('aria-label', 'طبقة تحرير مناطق التفاعل للمطوّر');
    for (const activity of activities) {
      if (activity.position && activity.type !== 'matching') {
        this.appendDeveloperZone(layer, activity, activity.position, `${activity.type}: ${activity.title || activity.id}`, (next) => { activity.position = next; });
      } else if (activity.type === 'matching' && activity.position) {
        this.appendDeveloperZone(layer, activity, activity.position, `نشاط توصيل: ${activity.title || activity.id}`, (next) => { activity.position = next; });
      }
      if (activity.type === 'matching') {
        for (const pair of activity.pairs || []) {
          if (pair.position) this.appendDeveloperZone(layer, activity, pair.position, `مصدر: ${this.zoneLabel(pair.left)}`, (next) => { pair.position = next; }, 'source');
        }
        for (const target of activity.targets || []) {
          if (target.position) this.appendDeveloperZone(layer, activity, target.position, `هدف: ${this.zoneLabel(target.label)}`, (next) => { target.position = next; }, 'target');
        }
      }
    }
    this.stage.append(layer);
  }

  zoneLabel(value) {
    if (typeof value === 'string') return value;
    return value?.[this.getLanguage?.() || 'ar'] || value?.ar || value?.en || value?.fr || 'منطقة';
  }

  appendDeveloperZone(layer, activity, position, label, updatePosition, kind = 'activity') {
    const zone = document.createElement('button');
    zone.type = 'button';
    zone.className = `developer-zone developer-zone--${kind}`;
    zone.style.left = `${Math.max(0, Math.min(99, Number(position.x) || 0))}%`;
    zone.style.top = `${Math.max(0, Math.min(99, Number(position.y) || 0))}%`;
    zone.style.width = `${Math.max(1, Math.min(100, Number(position.w) || 6))}%`;
    zone.style.height = `${Math.max(1, Math.min(100, Number(position.h) || 5))}%`;
    zone.innerHTML = `<span class="developer-zone-label">${this.escapeText(label)}</span><span class="developer-zone-resize" aria-hidden="true"></span>`;
    zone.setAttribute('aria-label', `تحرير موضع ${label}`);
    let startX = 0; let startY = 0; let original = null; let activePosition = { ...position }; let moved = false; let resizing = false;
    zone.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const rect = this.stage.getBoundingClientRect();
      startX = event.clientX; startY = event.clientY;
      original = { ...activePosition };
      resizing = event.target?.classList?.contains('developer-zone-resize');
      moved = false;
      zone.setPointerCapture?.(event.pointerId);
      const move = (moveEvent) => {
        const dx = (moveEvent.clientX - startX) / Math.max(1, rect.width) * 100;
        const dy = (moveEvent.clientY - startY) / Math.max(1, rect.height) * 100;
        if (Math.abs(dx) + Math.abs(dy) > .5) moved = true;
        if (!moved) return;
        let next;
        if (resizing) {
          next = { ...original, w: Math.max(1, Math.min(100 - original.x, original.w + dx)), h: Math.max(1, Math.min(100 - original.y, original.h + dy)) };
        } else {
          next = { ...original, x: Math.max(0, Math.min(100 - original.w, original.x + dx)), y: Math.max(0, Math.min(100 - original.h, original.y + dy)) };
        }
        activePosition = next;
        updatePosition(next);
        zone.style.left = `${next.x}%`; zone.style.top = `${next.y}%`; zone.style.width = `${next.w}%`; zone.style.height = `${next.h}%`;
      };
      const finish = () => {
        zone.removeEventListener('pointermove', move);
        zone.removeEventListener('pointerup', finish);
        zone.removeEventListener('pointercancel', finish);
        if (moved) this.onDeveloperDirty?.();
        else this.onDeveloperSelect?.(activity);
      };
      zone.addEventListener('pointermove', move);
      zone.addEventListener('pointerup', finish, { once: true });
      zone.addEventListener('pointercancel', finish, { once: true });
    });
    zone.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); });
    layer.append(zone);
  }

  escapeText(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  setDeveloperMode(enabled) {
    this.developerMode = Boolean(enabled);
    this.selectedMatchSource = null;
    this.refreshMarkers();
  }

  beginRegionSelection(onSelected, { label = 'اسحب لتحديد المنطقة' } = {}) {
    if (!this.developerMode || this.regionSelection) return;
    const surface = document.createElement('div');
    surface.className = 'region-selection-surface';
    surface.innerHTML = `<span class="region-selection-instruction">${this.escapeText(label)}</span><div class="region-selection-rectangle" hidden></div>`;
    this.stage.append(surface);
    const rectangle = surface.querySelector('.region-selection-rectangle');
    let origin = null; let current = null; let selecting = false;
    const getPoint = (event) => {
      const rect = this.stage.getBoundingClientRect();
      return { x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)), y: Math.max(0, Math.min(rect.height, event.clientY - rect.top)) };
    };
    const updateRect = () => {
      if (!origin || !current) return;
      const left = Math.min(origin.x, current.x); const top = Math.min(origin.y, current.y);
      rectangle.hidden = false;
      rectangle.style.left = `${left}px`; rectangle.style.top = `${top}px`;
      rectangle.style.width = `${Math.abs(current.x - origin.x)}px`; rectangle.style.height = `${Math.abs(current.y - origin.y)}px`;
    };
    const cleanup = () => { surface.remove(); this.regionSelection = null; };
    surface.addEventListener('pointerdown', (event) => {
      if (event.target.closest('.region-selection-instruction')) return;
      event.preventDefault();
      selecting = true; origin = getPoint(event); current = origin;
      surface.setPointerCapture?.(event.pointerId); updateRect();
    });
    surface.addEventListener('pointermove', (event) => { if (!selecting) return; current = getPoint(event); updateRect(); });
    const finish = (event) => {
      if (!selecting) return;
      current = getPoint(event); selecting = false;
      const width = Math.abs(current.x - origin.x); const height = Math.abs(current.y - origin.y);
      const stageWidth = Math.max(1, this.stage.clientWidth); const stageHeight = Math.max(1, this.stage.clientHeight);
      cleanup();
      if (width < 6 || height < 6) { this.onToast?.('اسحب مستطيلًا أكبر قليلًا لتحديد موضع التفاعل.'); return; }
      onSelected?.({
        x: Math.round(Math.min(origin.x, current.x) / stageWidth * 1000) / 10,
        y: Math.round(Math.min(origin.y, current.y) / stageHeight * 1000) / 10,
        w: Math.round(width / stageWidth * 1000) / 10,
        h: Math.round(height / stageHeight * 1000) / 10
      });
    };
    surface.addEventListener('pointerup', finish);
    surface.addEventListener('pointercancel', finish);
    this.regionSelection = { surface, cleanup };
  }

  async toggleMarkerAudio(activity, button) {
    try {
      if (this.markerAudio && this.markerAudioButton === button && !this.markerAudio.paused) {
        this.markerAudio.pause();
        button.classList.remove('playing');
        const completed = Boolean(this.getResult?.(activity.id)?.completed);
        button.classList.toggle('done', completed);
        button.innerHTML = `<span class="marker-icon" aria-hidden="true">▶</span><span class="marker-done" aria-hidden="true">${completed ? '✓' : ''}</span>`;
        button.setAttribute('aria-label', `${activity.title || 'الصوت'} — تشغيل الصوت`);
        return;
      }
      if (this.markerAudio) {
        this.markerAudio.pause();
        this.markerAudio.currentTime = 0;
      }
      if (this.markerAudioButton && this.markerAudioButton.isConnected) {
        const oldActivityId = this.markerAudioActivityId;
        const completed = Boolean(this.getResult?.(oldActivityId)?.completed);
        this.markerAudioButton.classList.remove('playing');
        this.markerAudioButton.classList.toggle('done', completed);
        this.markerAudioButton.innerHTML = `<span class="marker-icon" aria-hidden="true">▶</span><span class="marker-done" aria-hidden="true">${completed ? '✓' : ''}</span>`;
      }
      const audio = new Audio(activity.audioDataUrl || lessonAssetUrl(this.lesson, activity.audio));
      audio.preload = 'auto';
      this.markerAudio = audio;
      this.markerAudioButton = button;
      this.markerAudioActivityId = activity.id;
      button.classList.add('playing');
      button.innerHTML = '<span class="marker-icon" aria-hidden="true">Ⅱ</span><span class="marker-done" aria-hidden="true"></span>';
      button.setAttribute('aria-label', `${activity.title || 'الصوت'} — إيقاف الصوت`);
      const resetMarker = () => {
        const activeButton = this.markerAudioButton?.isConnected && this.markerAudioActivityId === activity.id ? this.markerAudioButton : button;
        const completed = Boolean(this.getResult?.(activity.id)?.completed);
        activeButton.classList.remove('playing');
        activeButton.classList.toggle('done', completed);
        activeButton.innerHTML = `<span class="marker-icon" aria-hidden="true">▶</span><span class="marker-done" aria-hidden="true">${completed ? '✓' : ''}</span>`;
        activeButton.setAttribute('aria-label', `${activity.title || 'الصوت'} — تشغيل الصوت`);
      };
      audio.addEventListener('ended', () => {
        if (this.markerAudio !== audio) return;
        resetMarker();
        this.markerAudio = null;
      }, { once: true });
      audio.addEventListener('error', () => {
        resetMarker();
        if (this.markerAudio === audio) this.markerAudio = null;
        this.onToast?.('تعذّر فتح الملف الصوتي. تحقّق من مسار الملف داخل lesson.json.');
      }, { once: true });
      await audio.play();
      this.onAudioPlayed?.(activity);
    } catch (error) {
      button.classList.remove('playing');
      button.innerHTML = '<span class="marker-icon" aria-hidden="true">▶</span><span class="marker-done" aria-hidden="true"></span>';
      this.onToast?.('لم يبدأ تشغيل الصوت. جرّب الضغط على زر التشغيل مرة أخرى.');
    }
  }
  async zoomBy(delta) {
    this.zoom = Math.min(2.1, Math.max(.65, Math.round((this.zoom + delta) * 100) / 100));
    await this.renderPage(this.currentPage);
  }
  async resetZoom() { this.zoom = 1; await this.renderPage(this.currentPage); }

  async startAnnotation({ activity, initialWork = null, onSave }) {
    if (this.annotation) return;
    this.stage.querySelector('.activity-marker-layer')?.remove();
    const cssWidth = this.stage.clientWidth;
    const cssHeight = this.stage.clientHeight;
    if (!cssWidth || !cssHeight) {
      this.onToast?.('تعذّر تجهيز مساحة الرسم. أعد فتح الدرس ثم حاول مرة أخرى.');
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.className = 'annotation-canvas';
    canvas.setAttribute('aria-label', 'ارسم أو اكتب فوق صفحة الكتاب');
    const ratio = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    canvas.width = Math.round(cssWidth * ratio);
    canvas.height = Math.round(cssHeight * ratio);
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
    const context = canvas.getContext('2d');
    context.scale(ratio, ratio);
    context.lineWidth = 3;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.strokeStyle = '#e53935';
    context.fillStyle = '#e53935';
    this.stage.append(canvas);

    const toolbar = document.createElement('div');
    toolbar.className = 'annotation-toolbar';
    toolbar.innerHTML = `
      <div class="annotation-toolbar-main" role="toolbar" aria-label="أدوات الرسم">
        <button class="annotation-tool active" type="button" data-tool="pen" aria-pressed="true" title="قلم">✎ <span>قلم</span></button>
        <button class="annotation-tool" type="button" data-tool="highlighter" aria-pressed="false" title="تظليل">▰ <span>تظليل</span></button>
        <button class="annotation-tool" type="button" data-tool="eraser" aria-pressed="false" title="ممحاة">⌫ <span>ممحاة</span></button>
        <button class="annotation-tool" type="button" data-tool="text" aria-pressed="false" title="كتابة نص على الصفحة">T <span>كتابة</span></button>
        <label class="annotation-color-label" title="لون القلم">لون <input type="color" data-action="color" value="#e53935" aria-label="لون الرسم والكتابة"></label>
        <button class="annotation-tool" type="button" data-action="undo" title="تراجع">↶ <span>تراجع</span></button>
      </div>
      <div class="annotation-toolbar-note-row">
        <textarea aria-label="ملاحظة عامة عن الصفحة" placeholder="ملاحظة اختيارية…">${escapeHtml(initialWork?.note || '')}</textarea>
        <button class="button button-secondary button-small" type="button" data-action="clear">مسح الصفحة</button>
        <button class="button button-primary button-small" type="button" data-action="save">حفظ</button>
        <button class="button button-ghost button-small" type="button" data-action="cancel">إغلاق</button>
      </div>`;
    this.stage.append(toolbar);

    if (initialWork?.drawingData) {
      await new Promise((resolve) => {
        const image = new Image();
        image.onload = () => { context.drawImage(image, 0, 0, cssWidth, cssHeight); resolve(); };
        image.onerror = resolve;
        image.src = initialWork.drawingData;
      });
    }

    let activeTool = 'pen';
    let drawing = false;
    let lastPoint = null;
    const undoStack = [];
    const colorPicker = toolbar.querySelector('[data-action="color"]');
    const toolButtons = [...toolbar.querySelectorAll('[data-tool]')];
    const positionFromEvent = (event) => {
      const rect = canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    const saveUndoState = () => {
      try {
        if (undoStack.length >= 20) undoStack.shift();
        undoStack.push(canvas.toDataURL('image/png'));
      } catch (_) { /* A full undo stack must not prevent drawing. */ }
    };
    const restoreData = (dataUrl) => new Promise((resolve) => {
      context.clearRect(0, 0, cssWidth, cssHeight);
      if (!dataUrl) { resolve(); return; }
      const image = new Image();
      image.onload = () => { context.drawImage(image, 0, 0, cssWidth, cssHeight); resolve(); };
      image.onerror = resolve;
      image.src = dataUrl;
    });
    const applyToolStyle = () => {
      context.globalCompositeOperation = activeTool === 'eraser' ? 'destination-out' : 'source-over';
      context.strokeStyle = colorPicker.value;
      context.fillStyle = colorPicker.value;
      context.globalAlpha = activeTool === 'highlighter' ? 0.3 : 1;
      context.lineWidth = activeTool === 'eraser' ? 22 : activeTool === 'highlighter' ? 13 : 3;
    };
    const setTool = (tool) => {
      activeTool = tool;
      toolButtons.forEach((button) => {
        const selected = button.dataset.tool === tool;
        button.classList.toggle('active', selected);
        button.setAttribute('aria-pressed', String(selected));
      });
      canvas.style.cursor = tool === 'text' ? 'text' : tool === 'eraser' ? 'cell' : 'crosshair';
      applyToolStyle();
      if (tool === 'text') this.onToast?.('اضغط على موضع الكتابة في الصفحة، ثم اكتب النص واضغط «إضافة».');
    };
    const wrapText = (text, maxWidth) => {
      const lines = [];
      for (const paragraph of String(text).split('\n')) {
        const words = paragraph.split(/\s+/).filter(Boolean);
        if (!words.length) { lines.push(''); continue; }
        let line = '';
        for (const word of words) {
          const candidate = line ? `${line} ${word}` : word;
          if (line && context.measureText(candidate).width > maxWidth) {
            lines.push(line);
            line = word;
          } else line = candidate;
        }
        lines.push(line);
      }
      return lines;
    };
    const openTextEditorAt = (point) => {
      this.stage.querySelector('.annotation-text-editor')?.remove();
      const editor = document.createElement('div');
      editor.className = 'annotation-text-editor';
      editor.style.left = `${Math.max(6, Math.min(cssWidth - 230, point.x))}px`;
      editor.style.top = `${Math.max(6, Math.min(cssHeight - 150, point.y))}px`;
      editor.innerHTML = `<textarea aria-label="النص المراد كتابته على الكتاب" placeholder="اكتب هنا…"></textarea><div><button class="button button-primary button-small" type="button" data-action="insert-text">إضافة</button><button class="button button-ghost button-small" type="button" data-action="cancel-text">إلغاء</button></div>`;
      this.stage.append(editor);
      const input = editor.querySelector('textarea');
      input.focus();
      editor.querySelector('[data-action="cancel-text"]').addEventListener('click', () => editor.remove());
      editor.querySelector('[data-action="insert-text"]').addEventListener('click', () => {
        const text = input.value.trim();
        if (!text) { input.focus(); return; }
        saveUndoState();
        context.save();
        context.globalCompositeOperation = 'source-over';
        context.globalAlpha = 1;
        context.fillStyle = colorPicker.value;
        context.font = 'bold 18px Arial, "Noto Sans Arabic", Tahoma, sans-serif';
        const rtl = /[\u0590-\u08ff]/.test(text);
        context.direction = rtl ? 'rtl' : 'ltr';
        context.textAlign = rtl ? 'right' : 'left';
        const maxTextWidth = Math.max(80, Math.min(230, cssWidth - point.x - 10));
        const lines = wrapText(text, maxTextWidth);
        const x = rtl ? Math.min(cssWidth - 5, point.x + maxTextWidth) : point.x;
        const startY = Math.max(22, point.y + 20);
        lines.forEach((line, index) => context.fillText(line, x, startY + index * 23, maxTextWidth));
        context.restore();
        editor.remove();
        setTool('pen');
      });
    };

    toolButtons.forEach((button) => button.addEventListener('click', () => setTool(button.dataset.tool)));
    colorPicker.addEventListener('input', applyToolStyle);
    canvas.addEventListener('pointerdown', (event) => {
      const point = positionFromEvent(event);
      if (activeTool === 'text') {
        event.preventDefault();
        openTextEditorAt(point);
        return;
      }
      drawing = true;
      saveUndoState();
      canvas.setPointerCapture?.(event.pointerId);
      lastPoint = point;
      applyToolStyle();
      context.beginPath();
      context.moveTo(lastPoint.x, lastPoint.y);
      if (activeTool !== 'eraser') context.lineTo(lastPoint.x + 0.1, lastPoint.y + 0.1);
      context.stroke();
    });
    canvas.addEventListener('pointermove', (event) => {
      if (!drawing) return;
      const point = positionFromEvent(event);
      applyToolStyle();
      context.beginPath();
      context.moveTo(lastPoint.x, lastPoint.y);
      context.lineTo(point.x, point.y);
      context.stroke();
      lastPoint = point;
    });
    const stopDrawing = () => {
      drawing = false;
      lastPoint = null;
      context.globalAlpha = 1;
      context.globalCompositeOperation = 'source-over';
    };
    canvas.addEventListener('pointerup', stopDrawing);
    canvas.addEventListener('pointercancel', stopDrawing);
    canvas.addEventListener('lostpointercapture', stopDrawing);

    const close = () => {
      canvas.remove();
      toolbar.remove();
      this.stage.querySelector('.annotation-text-editor')?.remove();
      this.annotation = null;
      this.refreshMarkers();
    };
    toolbar.querySelector('[data-action="undo"]').addEventListener('click', async () => {
      if (!undoStack.length) { this.onToast?.('لا توجد خطوة للتراجع عنها.'); return; }
      await restoreData(undoStack.pop());
    });
    toolbar.querySelector('[data-action="clear"]').addEventListener('click', async () => {
      saveUndoState();
      await restoreData(null);
    });
    toolbar.querySelector('[data-action="cancel"]').addEventListener('click', close);
    toolbar.querySelector('[data-action="save"]').addEventListener('click', async () => {
      const saveButton = toolbar.querySelector('[data-action="save"]');
      saveButton.disabled = true;
      try {
        const data = { drawingData: canvas.toDataURL('image/png'), note: toolbar.querySelector('.annotation-toolbar-note-row textarea').value.trim() };
        await onSave(data);
        close();
      } catch (error) {
        saveButton.disabled = false;
        this.onToast?.(error.message || 'تعذّر حفظ الرسم.');
      }
    });
    setTool('pen');
    this.annotation = { canvas, toolbar, close, activity };
  }

  destroy() {
    this.markerAudio?.pause?.();
    this.markerAudio = null;
    this.resizeObserver?.disconnect();
    try { this.renderTask?.cancel(); } catch (_) {}
    this.annotation?.close?.();
    this.mount.innerHTML = '';
  }
}
