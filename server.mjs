import http from 'node:http';
import { createReadStream, existsSync, statSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const host = process.env.HOST || 'localhost';
const port = Number(process.env.PORT || 5173);
const mimeTypes = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.pdf': 'application/pdf', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.woff': 'font/woff', '.woff2': 'font/woff2'
};

function safelyResolve(urlPath) {
  let decoded;
  try { decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0]); }
  catch (_) { return null; }
  if (decoded === '/') decoded = '/index.html';
  const normalized = path.normalize(decoded).replace(/^([/\\]*\.\.[/\\])+/, '');
  const full = path.resolve(root, `.${normalized.startsWith('/') ? normalized : `/${normalized}`}`);
  return full === root || full.startsWith(`${root}${path.sep}`) ? full : null;
}

function sendBufferWithRange(request, response, buffer, contentType) {
  const total = buffer.length;
  const range = request.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : total - 1;

    if (start >= total || end >= total || start > end) {
      response.writeHead(416, { 'Content-Range': `bytes */${total}`, 'Access-Control-Allow-Origin': '*' });
      return response.end();
    }

    const chunk = buffer.subarray(start, end + 1);
    response.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${total}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunk.length,
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=86400'
    });
    response.end(chunk);
  } else {
    response.writeHead(200, {
      'Content-Length': total,
      'Accept-Ranges': 'bytes',
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=86400'
    });
    response.end(buffer);
  }
}

function sendFileWithRange(request, response, filePath, contentType) {
  const stat = statSync(filePath);
  const total = stat.size;
  const range = request.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : total - 1;

    if (start >= total || end >= total || start > end) {
      response.writeHead(416, { 'Content-Range': `bytes */${total}`, 'Access-Control-Allow-Origin': '*' });
      return response.end();
    }

    const chunksize = (end - start) + 1;
    response.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${total}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*',
      'X-Content-Type-Options': 'nosniff'
    });
    createReadStream(filePath, { start, end }).pipe(response);
  } else {
    response.writeHead(200, {
      'Content-Length': total,
      'Accept-Ranges': 'bytes',
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': filePath.endsWith('.html') || filePath.endsWith('.json') ? 'no-cache' : 'public, max-age=3600'
    });
    createReadStream(filePath).pipe(response);
  }
}

function normalizeDriveUrl(rawUrl) {
  const str = String(rawUrl || '').trim();
  const driveMatch = str.match(/\/file\/d\/([\w-]+)/i) || str.match(/[?&]id=([\w-]+)/i);
  if (driveMatch) {
    return `https://drive.google.com/uc?export=download&id=${driveMatch[1]}`;
  }
  return str;
}

const server = http.createServer((request, response) => {
  const parsedUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // Proxy endpoint to bypass CORS for Google Drive and external files
  if (pathname === '/api/proxy') {
    const targetUrl = parsedUrl.searchParams.get('url');
    if (!targetUrl) {
      response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Missing url parameter');
      return;
    }
    const directUrl = normalizeDriveUrl(targetUrl);
    fetch(directUrl, { redirect: 'follow' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buffer = Buffer.from(await res.arrayBuffer());
        const contentType = res.headers.get('content-type') || (targetUrl.includes('.pdf') ? 'application/pdf' : 'application/octet-stream');
        sendBufferWithRange(request, response, buffer, contentType);
      })
      .catch((err) => {
        response.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        response.end(`Failed to proxy file: ${err.message}`);
      });
    return;
  }

  // Handle API requests from developer tools
  if (request.method === 'POST') {
    const url = pathname;

    // Download remote file (e.g. Google Drive) directly to local lessons/uploads/
    if (url === '/api/download-remote') {
      let body = '';
      request.on('data', (chunk) => { body += chunk; });
      request.on('end', async () => {
        try {
          const { url: remoteUrl, fileName } = JSON.parse(body);
          if (!remoteUrl) throw new Error('رابط الملف مطلوب');
          const directUrl = normalizeDriveUrl(remoteUrl);
          const res = await fetch(directUrl, { redirect: 'follow' });
          if (!res.ok) throw new Error(`فشل تحميل الملف: HTTP ${res.status}`);
          const buffer = Buffer.from(await res.arrayBuffer());

          const uploadsDir = path.join(root, 'lessons', 'uploads');
          if (!existsSync(uploadsDir)) mkdirSync(uploadsDir, { recursive: true });

          const safeName = (fileName || `remote-${Date.now()}`).replace(/[^\w.-]+/g, '_');
          const ext = remoteUrl.toLowerCase().includes('.pdf') || buffer.slice(0, 5).toString().includes('%PDF') ? '.pdf' : '.mp3';
          const finalName = safeName.endsWith(ext) ? safeName : `${safeName}${ext}`;
          const filePath = path.join(uploadsDir, finalName);
          writeFileSync(filePath, buffer);

          response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          response.end(JSON.stringify({ ok: true, localPath: `lessons/uploads/${finalName}` }));
        } catch (err) {
          response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          response.end(JSON.stringify({ ok: false, error: err.message }));
        }
      });
      return;
    }

    // 1. Save entire catalog (lessons/index.json)
    if (url === '/api/save-catalog') {
      let body = '';
      request.on('data', (chunk) => { body += chunk; });
      request.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          const indexPath = path.join(root, 'lessons', 'index.json');
          writeFileSync(indexPath, JSON.stringify(parsed, null, 2), 'utf8');
          response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          response.end(JSON.stringify({ ok: true, message: 'تم حفظ الفهرس بنجاح' }));
        } catch (err) {
          response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          response.end(JSON.stringify({ ok: false, error: err.message }));
        }
      });
      return;
    }

    // 2. Save individual lesson configuration
    if (url === '/api/save-lesson-config') {
      let body = '';
      request.on('data', (chunk) => { body += chunk; });
      request.on('end', () => {
        try {
          const { lessonId, lessonData } = JSON.parse(body);
          if (!lessonId || !lessonData) throw new Error('بيانات الدرس غير مكتملة');

          // Check if lesson has a dedicated lesson.json file
          const dedicatedPath = path.join(root, 'lessons', lessonId, 'lesson.json');
          if (existsSync(dedicatedPath)) {
            writeFileSync(dedicatedPath, JSON.stringify(lessonData, null, 2), 'utf8');
          }

          // Also update lessonData inside lessons/index.json if present
          const indexPath = path.join(root, 'lessons', 'index.json');
          if (existsSync(indexPath)) {
            const catalog = JSON.parse(readFileSync(indexPath, 'utf8'));
            const entry = (catalog.lessons || []).find((l) => l.id === lessonId);
            if (entry) {
              if (entry.lessonData) entry.lessonData = lessonData;
              if (lessonData.pages) entry.pageCount = lessonData.pages.length;
              writeFileSync(indexPath, JSON.stringify(catalog, null, 2), 'utf8');
            }
          }

          response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          response.end(JSON.stringify({ ok: true }));
        } catch (err) {
          response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          response.end(JSON.stringify({ ok: false, error: err.message }));
        }
      });
      return;
    }

    // 3. Upload file (PDF or audio) as base64
    if (url === '/api/upload-file') {
      let body = '';
      request.on('data', (chunk) => { body += chunk; });
      request.on('end', () => {
        try {
          const { fileName, fileData, subfolder } = JSON.parse(body);
          if (!fileName || !fileData) throw new Error('الملف غير مكتمل');

          const safeFileName = path.basename(fileName);
          const targetDir = path.join(root, 'lessons', subfolder ? path.basename(subfolder) : 'uploads');
          if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });

          const targetPath = path.join(targetDir, safeFileName);
          const base64Content = fileData.replace(/^data:[^;]+;base64,/, '');
          writeFileSync(targetPath, Buffer.from(base64Content, 'base64'));

          const relativeUrl = `lessons/${subfolder ? `${path.basename(subfolder)}/` : 'uploads/'}${safeFileName}`;
          response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          response.end(JSON.stringify({ ok: true, url: relativeUrl }));
        } catch (err) {
          response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          response.end(JSON.stringify({ ok: false, error: err.message }));
        }
      });
      return;
    }
  }

  const filePath = safelyResolve(request.url || '/');
  if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end('404 - File not found');
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  if (request.method === 'HEAD') {
    response.writeHead(200, {
      'Content-Type': mimeTypes[ext] || 'application/octet-stream',
      'Content-Length': statSync(filePath).size,
      'Accept-Ranges': 'bytes'
    });
    return response.end();
  }
  sendFileWithRange(request, response, filePath, mimeTypes[ext] || 'application/octet-stream');
});

server.listen(port, host, () => {
  const url = `http://${host}:${port}`;
  console.log(`\nتعلّم تفاعلي يعمل الآن: ${url}`);
  console.log(`إدارة المواد: ${url}/manage.html`);
  console.log('لإيقاف الخادم اضغط Ctrl+C.\n');
  if (process.argv.includes('--open')) {
    const target = `${url}/manage.html`;
    setTimeout(() => {
      if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', target], { stdio: 'ignore', detached: true }).unref();
      else if (process.platform === 'darwin') spawn('open', [target], { stdio: 'ignore', detached: true }).unref();
      else spawn('xdg-open', [target], { stdio: 'ignore', detached: true }).unref();
    }, 500);
  }
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') console.error(`المنفذ ${port} مستخدم بالفعل. غيّر PORT أو أوقف الخادم الآخر.`);
  else console.error(error);
  process.exitCode = 1;
});

server.listen(port, host, () => {
  const url = `http://${host}:${port}`;
  console.log(`\nتعلّم تفاعلي يعمل الآن: ${url}`);
  console.log(`إدارة المواد: ${url}/manage.html`);
  console.log('لإيقاف الخادم اضغط Ctrl+C.\n');
  if (process.argv.includes('--open')) {
    const target = `${url}/manage.html`;
    setTimeout(() => {
      if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', target], { stdio: 'ignore', detached: true }).unref();
      else if (process.platform === 'darwin') spawn('open', [target], { stdio: 'ignore', detached: true }).unref();
      else spawn('xdg-open', [target], { stdio: 'ignore', detached: true }).unref();
    }, 500);
  }
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') console.error(`المنفذ ${port} مستخدم بالفعل. غيّر PORT أو أوقف الخادم الآخر.`);
  else console.error(error);
  process.exitCode = 1;
});
