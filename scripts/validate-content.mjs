import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const indexPath = path.join(root, 'lessons', 'index.json');
const allowedTypes = new Set(['audio', 'read_aloud', 'mcq', 'matching', 'text_answer', 'drawing']);
const errors = [];
const warnings = [];
const isExternal = (value) => /^(?:https?:|data:|blob:)/i.test(String(value || ''));
const exists = async (file) => stat(file).then((value) => value.isFile(), () => false);
const safeResolve = (base, relative, description) => {
  if (typeof relative !== 'string' || !relative.trim()) {
    errors.push(`${description}: missing file path`);
    return null;
  }
  const target = path.resolve(base, relative);
  const boundary = base.endsWith(path.sep) ? base : base + path.sep;
  if (target !== base && !target.startsWith(boundary)) {
    errors.push(`${description}: path escapes its content folder (${relative})`);
    return null;
  }
  return target;
};
const readJson = async (file, description) => {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { errors.push(`${description}: ${error.message}`); return null; }
};

const index = await readJson(indexPath, 'lessons/index.json');
if (!index) process.exit(1);
if (!Array.isArray(index.subjects) || !Array.isArray(index.lessons)) {
  console.error('Expected index.json to contain subjects[] and lessons[].');
  process.exit(1);
}

const subjectIds = new Set();
for (const subject of index.subjects) {
  if (!subject.id || subjectIds.has(subject.id)) errors.push(`Duplicate or missing subject id: ${subject.id || '(missing)'}`);
  subjectIds.add(subject.id);
  const gradeIds = new Set();
  for (const grade of subject.grades || []) {
    if (!grade.id || gradeIds.has(grade.id)) errors.push(`Duplicate or missing grade id in ${subject.id}: ${grade.id || '(missing)'}`);
    gradeIds.add(grade.id);
    const unitIds = new Set();
    for (const unit of grade.units || []) {
      if (!unit.id || unitIds.has(unit.id)) errors.push(`Duplicate or missing unit id in ${subject.id}/${grade.id}: ${unit.id || '(missing)'}`);
      unitIds.add(unit.id);
    }
  }
}

const lessonIds = new Set();
const codes = new Set();
for (const entry of index.lessons) {
  const label = entry.id || '(missing lesson id)';
  if (!entry.id || lessonIds.has(entry.id)) errors.push(`Duplicate or missing lesson id: ${label}`);
  lessonIds.add(entry.id);
  if (entry.shortCode) {
    const code = String(entry.shortCode).toUpperCase();
    if (codes.has(code)) errors.push(`Duplicate lesson code: ${entry.shortCode}`);
    codes.add(code);
  } else warnings.push(`${label}: no shortCode (this is optional)`);

  const subject = index.subjects.find((item) => item.id === entry.subjectId);
  const grade = subject?.grades?.find((item) => item.id === entry.gradeId);
  const unit = grade?.units?.find((item) => item.id === entry.unitId);
  if (!subject || !grade || !unit) errors.push(`${label}: subjectId/gradeId/unitId does not point to a valid catalogue path`);

  let lesson = entry.lessonData || null;
  let lessonDir = root;
  if (!lesson) {
    if (isExternal(entry.lessonFile)) {
      warnings.push(`${label}: external lessonFile was not downloaded for content validation`);
      continue;
    }
    const lessonFile = safeResolve(root, entry.lessonFile, `${label} lessonFile`);
    if (!lessonFile || !(await exists(lessonFile))) {
      errors.push(`${label}: lessonFile not found at ${entry.lessonFile || '(empty)'}`);
      continue;
    }
    lesson = await readJson(lessonFile, `${label} lesson.json`);
    if (!lesson) continue;
    lessonDir = path.dirname(lessonFile);
  }

  if (!lesson.pdf) errors.push(`${label}: PDF link/path is missing`);
  else if (!isExternal(lesson.pdf)) {
    const pdfFile = safeResolve(lessonDir, lesson.pdf, `${label} PDF`);
    if (!pdfFile || !(await exists(pdfFile))) errors.push(`${label}: PDF not found (${lesson.pdf})`);
    else {
      const signature = (await readFile(pdfFile)).subarray(0, 5).toString('ascii');
      if (signature !== '%PDF-') errors.push(`${label}: file declared as PDF does not have a PDF signature`);
    }
  }

  if (lesson.coverImage && !isExternal(lesson.coverImage)) {
    const coverFile = safeResolve(lessonDir, lesson.coverImage, `${label} coverImage`);
    if (coverFile && !(await exists(coverFile))) errors.push(`${label}: cover image not found (${lesson.coverImage})`);
  }
  for (const audio of lesson.audioFiles || []) {
    if (isExternal(audio)) continue;
    const audioFile = safeResolve(lessonDir, audio, `${label} audioFiles`);
    if (audioFile && !(await exists(audioFile))) errors.push(`${label}: audio file not found (${audio})`);
  }
  if (!Array.isArray(lesson.pages) || lesson.pages.length === 0) errors.push(`${label}: lesson data needs a non-empty pages[] array`);
  const activityIds = new Set();
  for (const page of lesson.pages || []) {
    if (!Number.isInteger(Number(page.number)) || Number(page.number) < 1) errors.push(`${label}: invalid page number ${page.number}`);
    if (page.previewImage && !isExternal(page.previewImage)) {
      const preview = safeResolve(lessonDir, page.previewImage, `${label} page ${page.number} preview`);
      if (preview && !(await exists(preview))) errors.push(`${label}: preview image not found (${page.previewImage})`);
    }
    for (const activity of page.activities || []) {
      if (!activity.id || activityIds.has(activity.id)) errors.push(`${label}: duplicate or missing activity id ${activity.id || '(missing)'}`);
      activityIds.add(activity.id);
      if (!allowedTypes.has(activity.type)) errors.push(`${label}/${activity.id}: unsupported activity type ${activity.type}`);
      if (!activity.title || !activity.prompt) warnings.push(`${label}/${activity.id}: title or prompt is missing`);
      if (activity.audio && !isExternal(activity.audio)) {
        const audioFile = safeResolve(lessonDir, activity.audio, `${label}/${activity.id} audio`);
        if (audioFile && !(await exists(audioFile))) errors.push(`${label}/${activity.id}: audio file not found (${activity.audio})`);
      }
      if (activity.type === 'audio' && !activity.position) {
        warnings.push(`${label}/${activity.id}: audio has no position; it will appear in the activity list but not as a play button on the PDF page`);
      }
      if (activity.position) {
        for (const coordinate of ['x', 'y']) {
          const value = Number(activity.position[coordinate]);
          if (!Number.isFinite(value) || value < 0 || value > 100) errors.push(`${label}/${activity.id}: position.${coordinate} must be between 0 and 100`);
        }
      }
      if (activity.type === 'mcq' && (!Array.isArray(activity.choices) || !activity.choices.some((choice) => choice.id === activity.correctAnswer))) {
        errors.push(`${label}/${activity.id}: MCQ correctAnswer must match a choice id`);
      }
    }
  }
}

for (const warning of warnings) console.warn(`WARN: ${warning}`);
if (errors.length) {
  for (const error of errors) console.error(`ERROR: ${error}`);
  console.error(`\nContent validation failed: ${errors.length} error(s), ${warnings.length} warning(s).`);
  process.exit(1);
}
console.log(`Content validation passed: ${index.subjects.length} subjects, ${index.lessons.length} lessons, ${codes.size} short codes, ${warnings.length} warning(s).`);
