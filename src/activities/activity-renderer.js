import { lessonAssetUrl } from '../services/lesson-service.js';

const META = {
  audio: { icon: '♫', action: 'استمع إلى الصوت' },
  read_aloud: { icon: '🔊', action: 'استمع إلى النص' },
  mcq: { icon: '✓', action: 'اختر الإجابة' },
  matching: { icon: '↔', action: 'نشاط توصيل' },
  text_answer: { icon: '✎', action: 'اكتب الإجابة' },
  drawing: { icon: '✐', action: 'رسم وتعليق' }
};
const LANGS = { ar: 'العربية', en: 'English', fr: 'Français' };
const SPEECH_LANG = { ar: 'ar-SA', en: 'en-US', fr: 'fr-FR' };
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const localized = (value, lang) => typeof value === 'string' ? value : (value?.[lang] ?? value?.ar ?? value?.en ?? value?.fr ?? '');
const normalize = (value) => String(value ?? '').normalize('NFKC').trim().toLocaleLowerCase().replace(/[.!؟?،,؛;:]+$/u, '').replace(/\s+/g, ' ');

function languageOptions(selected) {
  return Object.entries(LANGS).map(([value, label]) => `<option value="${value}" ${selected === value ? 'selected' : ''}>${label}</option>`).join('');
}

function feedbackMarkup(saved, activity, lang) {
  if (!saved?.completed) return '';
  let type = 'neutral';
  let headline = 'تم حفظ المحاولة';
  if (saved.isCorrect === true) { type = 'success'; headline = 'إجابة صحيحة، أحسنت!'; }
  if (saved.isCorrect === false) { type = 'retry'; headline = 'ليست الإجابة الصحيحة هذه المرة.'; }
  if (saved.isCorrect === null && activity.type !== 'drawing' && activity.type !== 'audio' && activity.type !== 'read_aloud') headline = 'تم حفظ إجابتك على هذا الجهاز.';
  const explanation = saved.isCorrect === false || saved.isCorrect === true ? localized(activity.explanation, lang) : '';
  const savedAt = saved.submittedAt ? new Date(saved.submittedAt).toLocaleString(lang === 'ar' ? 'ar' : lang === 'fr' ? 'fr-FR' : 'en-US', { dateStyle: 'short', timeStyle: 'short' }) : '';
  return `<div class="activity-feedback ${type}" role="status"><strong>${headline}</strong>${explanation ? `<br>${escapeHtml(explanation)}` : ''}${savedAt ? `<br><span>آخر حفظ: ${escapeHtml(savedAt)}</span>` : ''}</div>`;
}

function activityContent(activity, lang, saved, lesson) {
  if (activity.type === 'mcq') {
    const answer = saved?.answer;
    return `<fieldset class="dialog-options" style="border:0;padding:0;margin:0"><legend class="field-label">${escapeHtml(localized(activity.prompt, lang))}</legend>${(activity.choices || []).map((choice) => `<label class="choice-option"><input type="radio" name="mcq-answer" value="${escapeHtml(choice.id)}" ${answer === choice.id ? 'checked' : ''}><span>${escapeHtml(localized(choice.label, lang))}</span></label>`).join('')}</fieldset>
      <div class="activity-actions"><button type="button" class="button button-primary" data-action="submit-mcq">تحقّق من الإجابة</button><button type="button" class="button button-ghost" data-action="clear-mcq">إعادة المحاولة</button></div>`;
  }
  if (activity.type === 'text_answer') {
    const answer = typeof saved?.answer === 'string' ? saved.answer : (saved?.studentWork?.text || '');
    return `<div><label class="field-label" for="text-answer">${escapeHtml(localized(activity.prompt, lang))}</label><input id="text-answer" class="field" type="text" maxlength="1200" autocomplete="off" placeholder="${escapeHtml(localized(activity.placeholder, lang) || 'اكتب إجابتك هنا')}" value="${escapeHtml(answer)}"><p class="field-help">ستُحفظ إجابتك محليًا على هذا الجهاز. لا تظهر الإجابة النموذجية قبل المحاولة.</p></div>
      <div class="activity-actions"><button type="button" class="button button-primary" data-action="submit-text">حفظ الإجابة</button></div>`;
  }
  if (activity.type === 'matching') {
    const answer = saved?.answer || {};
    return `<p>${escapeHtml(localized(activity.prompt, lang))}</p><div class="matching-list">${(activity.pairs || []).map((pair) => `<div class="match-row"><div class="match-source">${escapeHtml(localized(pair.left, lang))}</div><select aria-label="اختيار مقابل ${escapeHtml(localized(pair.left, lang))}" data-pair-id="${escapeHtml(pair.id)}"><option value="">اختر الاسم…</option>${(activity.targets || []).map((target) => `<option value="${escapeHtml(target.id)}" ${answer[pair.id] === target.id ? 'selected' : ''}>${escapeHtml(target.label)}</option>`).join('')}</select></div>`).join('')}</div>
      <div class="activity-actions"><button type="button" class="button button-primary" data-action="submit-match">تحقّق من التوصيل</button><button type="button" class="button button-ghost" data-action="clear-match">مسح الاختيارات</button></div>`;
  }
  if (activity.type === 'audio') {
    const src = activity.audioDataUrl || (activity.audio ? lessonAssetUrl(lesson, activity.audio) : '');
    return `<p>${escapeHtml(localized(activity.prompt, lang))}</p><div class="audio-player"><button type="button" class="audio-play" aria-label="تشغيل الصوت" data-action="toggle-audio">▶</button><div class="audio-player-copy"><strong>ملف صوت محلي</strong><span>يمكن التشغيل والإيقاف دون إرسال بيانات إلى أي خدمة.</span></div><audio id="activity-audio" preload="metadata" src="${escapeHtml(src)}"></audio></div>
      <div class="activity-actions"><button type="button" class="button button-secondary" data-action="stop-audio">إيقاف الصوت</button></div>`;
  }
  if (activity.type === 'read_aloud') {
    return `<p>${escapeHtml(localized(activity.prompt, lang))}</p><div class="annotation-hint" id="speech-text">${escapeHtml(localized(activity.text, lang))}</div>
      <div class="voice-settings"><div><label class="field-label" for="speech-language">لغة القراءة</label><select id="speech-language" class="field">${languageOptions(lang)}</select></div><div><label class="field-label" for="speech-voice">الصوت المتاح على جهازك</label><select id="speech-voice" class="field"><option value="">الصوت الافتراضي</option></select></div></div>
      <p class="field-help">الأصوات المتاحة تختلف بحسب نظام التشغيل والمتصفح واللغات المثبّتة.</p>
      <div class="activity-actions"><button type="button" class="button button-primary" data-action="speak">▶ تشغيل القراءة</button><button type="button" class="button button-secondary" data-action="stop-speech">إيقاف</button></div>`;
  }
  if (activity.type === 'drawing') {
    return `<p>${escapeHtml(localized(activity.prompt, lang))}</p><div class="annotation-hint">سيفتح وضع الرسم فوق صفحة PDF الحالية. استخدم إصبعك على الهاتف أو الفأرة على الكمبيوتر، ثم احفظ الرسم والتعليق النصي.</div>
      <label class="field-label" for="annotation-note">تعليق اختياري</label><textarea class="field" id="annotation-note" placeholder="اكتب ملاحظة عن رسمك…">${escapeHtml(saved?.studentWork?.note || '')}</textarea>
      <div class="activity-actions"><button type="button" class="button button-primary" data-action="start-annotation">ابدأ الرسم على الصفحة</button></div>`;
  }
  return `<p>نوع النشاط غير معروف: ${escapeHtml(activity.type)}</p>`;
}

export function openActivityDialog({ activity, lesson, language = 'ar', saved = null, progressService, viewer, onSaved, onToast }) {
  if (activity.type === 'drawing' && viewer?.annotation) {
    onToast?.('وضع الرسم مفتوح بالفعل. احفظ العمل أو أنهِ الرسم أولًا.');
    return;
  }
  const meta = META[activity.type] || { icon: '●' };
  const dialog = document.createElement('dialog');
  dialog.className = 'activity-dialog';
  dialog.setAttribute('aria-labelledby', `activity-title-${activity.id}`);
  dialog.innerHTML = `<div class="dialog-card">
    <div class="dialog-header"><div class="dialog-type-icon" aria-hidden="true">${meta.icon}</div><div class="dialog-heading"><h2 id="activity-title-${activity.id}">${escapeHtml(activity.title)}</h2><p>${escapeHtml(lesson.title)}</p></div><button type="button" class="dialog-close" aria-label="إغلاق النشاط">×</button></div>
    <div class="dialog-body">${activityContent(activity, language, saved, lesson)}<div id="activity-feedback-slot">${feedbackMarkup(saved, activity, language)}</div></div>
  </div>`;
  document.body.append(dialog);
  const audio = dialog.querySelector('#activity-audio');
  let speechButtonLabel = null;
  const closeDialog = () => {
    if (audio) audio.pause();
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    try { dialog.close(); } catch (_) { dialog.removeAttribute('open'); }
    dialog.remove();
  };
  dialog.querySelector('.dialog-close').addEventListener('click', closeDialog);
  dialog.addEventListener('click', (event) => { if (event.target === dialog) closeDialog(); });
  dialog.addEventListener('cancel', () => {
    if (audio) audio.pause();
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    dialog.remove();
  }, { once: true });

  const showFeedback = (result) => {
    const slot = dialog.querySelector('#activity-feedback-slot');
    if (slot) slot.innerHTML = feedbackMarkup(result, activity, language);
  };
  const save = async ({ answer = null, isCorrect = null, score = null, studentWork = null, completed = true }) => {
    const result = await progressService.saveResult({
      lessonId: lesson.id,
      activityId: activity.id,
      completed,
      answer,
      isCorrect,
      score,
      studentWork
    });
    saved = result;
    showFeedback(result);
    await onSaved?.(result);
    return result;
  };

  if (activity.type === 'mcq') {
    dialog.querySelector('[data-action="submit-mcq"]').addEventListener('click', async () => {
      const choice = dialog.querySelector('input[name="mcq-answer"]:checked');
      if (!choice) { onToast?.('اختر إجابة أولًا ثم اضغط «تحقّق من الإجابة».'); return; }
      const isCorrect = choice.value === activity.correctAnswer;
      await save({ answer: choice.value, isCorrect, score: isCorrect ? 1 : 0 });
    });
    dialog.querySelector('[data-action="clear-mcq"]').addEventListener('click', () => {
      dialog.querySelectorAll('input[name="mcq-answer"]').forEach((input) => { input.checked = false; });
    });
  }

  if (activity.type === 'text_answer') {
    dialog.querySelector('[data-action="submit-text"]').addEventListener('click', async () => {
      const answer = dialog.querySelector('#text-answer').value.trim();
      if (!answer) { onToast?.('اكتب إجابتك قبل الحفظ.'); dialog.querySelector('#text-answer').focus(); return; }
      const expected = activity.expectedAnswers || [];
      if (!expected.length || activity.saveAsWork) {
        await save({ answer, isCorrect: null, score: null, studentWork: { text: answer } });
      } else {
        const isCorrect = expected.some((item) => normalize(item) === normalize(answer));
        await save({ answer, isCorrect, score: isCorrect ? 1 : 0, studentWork: { text: answer } });
      }
    });
  }

  if (activity.type === 'matching') {
    dialog.querySelector('[data-action="submit-match"]').addEventListener('click', async () => {
      const answer = {};
      dialog.querySelectorAll('[data-pair-id]').forEach((select) => { answer[select.dataset.pairId] = select.value; });
      if ((activity.pairs || []).some((pair) => !answer[pair.id])) { onToast?.('أكمل جميع الاختيارات قبل التصحيح.'); return; }
      const correctPairs = activity.correctPairs || {};
      const total = (activity.pairs || []).length;
      const correctCount = (activity.pairs || []).filter((pair) => answer[pair.id] === correctPairs[pair.id]).length;
      await save({ answer, isCorrect: correctCount === total, score: total ? correctCount / total : 0 });
      const feedback = dialog.querySelector('#activity-feedback-slot .activity-feedback');
      if (feedback) feedback.insertAdjacentHTML('beforeend', `<br>النتيجة: ${correctCount} من ${total}`);
    });
    dialog.querySelector('[data-action="clear-match"]').addEventListener('click', () => {
      dialog.querySelectorAll('[data-pair-id]').forEach((select) => { select.value = ''; });
    });
  }

  if (activity.type === 'audio' && audio) {
    const playButton = dialog.querySelector('[data-action="toggle-audio"]');
    const stopButton = dialog.querySelector('[data-action="stop-audio"]');
    let recordedPlayed = Boolean(saved?.answer?.played);
    const toggle = async () => {
      if (audio.paused) {
        try {
          await audio.play();
          playButton.textContent = 'Ⅱ';
          playButton.setAttribute('aria-label', 'إيقاف مؤقت');
          if (!recordedPlayed) {
            recordedPlayed = true;
            await save({ answer: { played: true, audio: activity.audio }, isCorrect: null, score: null });
          }
        } catch (_) {
          onToast?.('تعذّر تشغيل ملف الصوت. تأكد من اتصالك أو أعد تنزيل الدرس.');
        }
      } else {
        audio.pause();
        playButton.textContent = '▶';
        playButton.setAttribute('aria-label', 'تشغيل الصوت');
      }
    };
    playButton.addEventListener('click', toggle);
    stopButton.addEventListener('click', () => { audio.pause(); audio.currentTime = 0; playButton.textContent = '▶'; playButton.setAttribute('aria-label', 'تشغيل الصوت'); });
    audio.addEventListener('ended', () => { playButton.textContent = '▶'; playButton.setAttribute('aria-label', 'تشغيل الصوت'); });
  }

  if (activity.type === 'read_aloud') {
    const langSelect = dialog.querySelector('#speech-language');
    const voiceSelect = dialog.querySelector('#speech-voice');
    const populateVoices = () => {
      if (!('speechSynthesis' in window)) return;
      const voices = window.speechSynthesis.getVoices();
      const previous = voiceSelect.value;
      voiceSelect.innerHTML = '<option value="">الصوت الافتراضي</option>' + voices.map((voice, index) => `<option value="${index}">${escapeHtml(voice.name)} — ${escapeHtml(voice.lang)}</option>`).join('');
      if ([...voiceSelect.options].some((option) => option.value === previous)) voiceSelect.value = previous;
    };
    populateVoices();
    if ('speechSynthesis' in window) window.speechSynthesis.addEventListener?.('voiceschanged', populateVoices);
    dialog.querySelector('[data-action="speak"]').addEventListener('click', async () => {
      if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) { onToast?.('خاصية القراءة الصوتية غير مدعومة في هذا المتصفح.'); return; }
      window.speechSynthesis.cancel();
      const selectedLanguage = langSelect.value;
      const text = localized(activity.text, selectedLanguage);
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = SPEECH_LANG[selectedLanguage] || 'ar-SA';
      const voices = window.speechSynthesis.getVoices();
      const chosen = voiceSelect.value !== '' ? voices[Number(voiceSelect.value)] : voices.find((voice) => voice.lang.toLowerCase().startsWith(selectedLanguage));
      if (chosen) utterance.voice = chosen;
      utterance.onstart = () => { speechButtonLabel = 'playing'; };
      utterance.onend = () => { speechButtonLabel = null; };
      window.speechSynthesis.speak(utterance);
      await save({ answer: { played: true, language: selectedLanguage, text }, isCorrect: null, score: null });
    });
    dialog.querySelector('[data-action="stop-speech"]').addEventListener('click', () => {
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
      speechButtonLabel = null;
    });
  }

  if (activity.type === 'drawing') {
    dialog.querySelector('[data-action="start-annotation"]').addEventListener('click', () => {
      const note = dialog.querySelector('#annotation-note').value.trim();
      closeDialog();
      viewer.startAnnotation({
        activity,
        initialWork: { ...(saved?.studentWork || {}), note },
        onSave: async (studentWork) => {
          await save({ answer: null, isCorrect: null, score: null, studentWork });
          onToast?.('تم حفظ الرسم والتعليق محليًا على هذا الجهاز.');
        }
      });
    });
  }

  try { dialog.showModal(); } catch (_) { dialog.setAttribute('open', ''); }
  const firstInput = dialog.querySelector('input, select, textarea, button');
  firstInput?.focus({ preventScroll: true });
  return { close: closeDialog, dialog };
}
