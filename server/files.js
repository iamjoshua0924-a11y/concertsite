import multer from 'multer';
import { ObjectId } from 'mongodb';
import { Readable } from 'node:stream';
import { badRequest, notFound } from './lib/util.js';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const ATTACH_TYPES = new Set([
  ...IMAGE_TYPES,
  'application/pdf',
  'text/plain',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/haansofthwp',
  'application/x-hwp',
  'application/zip',
  'audio/mpeg',
]);

export const uploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 10 },
});

function decodeName(name) {
  // multer는 latin1로 파일명을 해석하므로 UTF-8로 복원
  try {
    return Buffer.from(name, 'latin1').toString('utf8');
  } catch {
    return name;
  }
}

export async function storeFile(bucket, { buffer, name, mimeType, meta = {} }) {
  const id = new ObjectId();
  await new Promise((resolve, reject) => {
    Readable.from(buffer)
      .pipe(bucket.openUploadStreamWithId(id, name, { metadata: { contentType: mimeType, ...meta } }))
      .on('finish', resolve)
      .on('error', reject);
  });
  return { fileId: id.toHexString(), name, type: mimeType, size: buffer.length };
}

export async function storeUploaded(bucket, files, { imagesOnly = false, meta = {} } = {}) {
  if (!files || !files.length) throw badRequest('업로드할 파일이 없습니다.');
  const allowed = imagesOnly ? IMAGE_TYPES : ATTACH_TYPES;
  for (const f of files) {
    if (!allowed.has(f.mimetype)) {
      throw badRequest(imagesOnly ? '이미지 파일(jpg, png, webp, gif)만 올릴 수 있습니다.' : `지원하지 않는 파일 형식입니다: ${f.mimetype}`);
    }
  }
  const out = [];
  for (const f of files) {
    out.push(await storeFile(bucket, { buffer: f.buffer, name: decodeName(f.originalname), mimeType: f.mimetype, meta }));
  }
  return out;
}

export async function deleteFile(bucket, fileId) {
  try {
    await bucket.delete(new ObjectId(fileId));
  } catch {
    // 이미 없으면 무시
  }
}

export async function streamFile(bucket, fileId, res) {
  let id;
  try {
    id = new ObjectId(fileId);
  } catch {
    throw notFound('파일을 찾을 수 없습니다.');
  }
  const [file] = await bucket.find({ _id: id }).limit(1).toArray();
  if (!file) throw notFound('파일을 찾을 수 없습니다.');
  const type = file.metadata?.contentType || 'application/octet-stream';
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Length', file.length);
  res.setHeader('Cache-Control', 'private, max-age=604800, immutable');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const inline = type.startsWith('image/') || type === 'application/pdf';
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.filename)}`);
  await new Promise((resolve, reject) => {
    bucket.openDownloadStream(id).on('error', reject).on('end', resolve).pipe(res);
  });
}

/** 회의록/문의 첨부: 클라이언트가 보낸 fileId 목록을 실제 GridFS 파일로 검증 */
export async function resolveAttachments(bucket, list) {
  if (!Array.isArray(list) || !list.length) return [];
  const ids = [];
  for (const item of list.slice(0, 10)) {
    try {
      ids.push(new ObjectId(String(item.fileId || item)));
    } catch {
      throw badRequest('첨부파일 정보가 올바르지 않습니다.');
    }
  }
  const files = await bucket.find({ _id: { $in: ids } }).toArray();
  return files.map((f) => ({ fileId: f._id.toHexString(), name: f.filename, type: f.metadata?.contentType || '', size: f.length }));
}
