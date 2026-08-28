import { createReadStream, existsSync, statSync } from 'fs';
import type http from 'http';
import { extname, join, normalize, relative, resolve, sep } from 'path';

const API_PREFIX =
  /^\/(health|ready|contract|auth|client|admin|workspace|orders|files|onboarding|tenant|platform|audit|webhooks|production|forms|drafts|schemas|ora|customers|notifications|public)\b/;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
};

export function isApiPath(path: string): boolean {
  return API_PREFIX.test(path);
}

export function rendererDir(): string {
  return process.env.MASCAYL_RENDERER_DIR || resolve(join(__dirname, '..', 'renderer'));
}

function safeJoin(root: string, reqPath: string): string | null {
  const decoded = decodeURIComponent(reqPath.split('?')[0] || '/');
  const cleaned = decoded.replace(/^\/+/, '');
  const target = resolve(join(root, cleaned || 'index.html'));
  const rel = relative(root, target);
  if (rel.startsWith('..') || rel.includes(`..${sep}`) || normalize(rel).startsWith('..')) return null;
  return target;
}

export function tryServeStatic(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  path: string
): boolean {
  const method = req.method || 'GET';
  if (method !== 'GET' && method !== 'HEAD') return false;
  if (isApiPath(path)) return false;
  const root = rendererDir();
  if (!existsSync(root)) return false;
  let file = safeJoin(root, path === '/' ? '/index.html' : path);
  if (!file) return false;
  if (!existsSync(file) || !statSync(file).isFile()) {
    const index = join(root, 'index.html');
    if (!existsSync(index)) return false;
    file = index;
  }
  const type = MIME[extname(file).toLowerCase()] || 'application/octet-stream';
  const stat = statSync(file);
  res.writeHead(200, {
    'content-type': type,
    'content-length': stat.size,
    'cache-control': extname(file) === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
  });
  if (method === 'HEAD') {
    res.end();
    return true;
  }
  createReadStream(file).pipe(res);
  return true;
}
