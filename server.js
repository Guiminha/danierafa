require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const multer = require('multer');
const { Client } = require('minio');

const app = express();
const PORT = process.env.PORT || 3000;

const MINIO_ACCESS_KEY = process.env.MINIO_ACCESS_KEY || '';
const MINIO_SECRET_KEY = process.env.MINIO_SECRET_KEY || '';
const MINIO_BUCKET = process.env.MINIO_BUCKET || 'wedding';
const MINIO_PREFIX = process.env.MINIO_PREFIX || 'uploads';
const MAX_FILE_MB = parseInt(process.env.MAX_FILE_MB || '200', 10);
const URL_EXPIRY = parseInt(process.env.URL_EXPIRY_SECONDS || (7 * 24 * 3600), 10);

const MINIO_API_ENDPOINT = process.env.MINIO_API_ENDPOINT || '127.0.0.1';
const MINIO_API_PORT = parseInt(process.env.MINIO_API_PORT || '9000', 10);
const MINIO_API_USE_SSL = (process.env.MINIO_API_USE_SSL || 'false') === 'true';

const ALLOWED_TYPES = {
  image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif', 'image/avif', 'image/bmp', 'image/tiff'],
  video: ['video/mp4', 'video/quicktime', 'video/x-m4v', 'video/webm', 'video/x-msvideo', 'video/x-matroska', 'video/3gpp', 'video/mpeg']
};

const ALLOWED_EXTENSIONS = [
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif', '.avif', '.bmp', '.tiff', '.tif',
  '.mp4', '.mov', '.m4v', '.webm', '.avi', '.mkv', '.3gp', '.mpeg', '.mpg'
];

const isAllowed = (mimeType, name) => {
  const allTypes = [...ALLOWED_TYPES.image, ...ALLOWED_TYPES.video];
  if (!allTypes.includes(String(mimeType || '').toLowerCase())) return false;
  const ext = path.extname(String(name || '')).toLowerCase();
  return ALLOWED_EXTENSIONS.includes(ext);
};

const minioClient = new Client({
  endPoint: MINIO_API_ENDPOINT,
  port: MINIO_API_PORT,
  useSSL: MINIO_API_USE_SSL,
  accessKey: MINIO_ACCESS_KEY,
  secretKey: MINIO_SECRET_KEY
});

const UPLOAD_DIR = path.join(os.tmpdir(), 'wedding-uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: MAX_FILE_MB * 1024 * 1024 }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache')
}));

const randomId = () => crypto.randomBytes(6).toString('hex');
const dateStamp = () => new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);

app.post('/api/upload-url', (req, res) => {
  const { name, type } = req.body || {};
  if (!isAllowed(type, name)) {
    return res.status(400).json({ error: 'Apenas fotos e vídeos são permitidos.' });
  }
  const safeName = path.basename(String(name || ''));
  const ext = path.extname(safeName).toLowerCase();
  const uniqueId = `${dateStamp()}-${randomId()}`;
  const objectName = `${MINIO_PREFIX}/${uniqueId}${ext}`;
  const thumbObjectName = `${MINIO_PREFIX}/thumbs/${uniqueId}.jpg`;
  res.json({ objectName, thumbObjectName });
});

const forwardToMinio = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Arquivo não enviado.' });
    const objectName = req.body.objectName;
    if (!objectName || !objectName.startsWith(MINIO_PREFIX + '/')) {
      return res.status(400).json({ error: 'Destino inválido.' });
    }
    const metaData = { 'Content-Type': req.file.mimetype };
    await minioClient.fPutObject(MINIO_BUCKET, objectName, req.file.path, metaData);
    fs.unlinkSync(req.file.path);
    res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao enviar para o MinIO:', err);
    res.status(500).json({ error: 'Falha ao enviar o arquivo.' });
  }
};

app.post('/api/upload', upload.single('file'), forwardToMinio);
app.post('/api/upload-thumb', upload.single('file'), forwardToMinio);

app.get('/api/file', async (req, res) => {
  const name = req.query.name;
  if (!name || !name.startsWith(MINIO_PREFIX + '/')) {
    return res.status(400).json({ error: 'Arquivo inválido.' });
  }
  try {
    const stat = await minioClient.statObject(MINIO_BUCKET, name);
    res.setHeader('Content-Type', stat.metaData['content-type'] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    const stream = await minioClient.getObject(MINIO_BUCKET, name);
    stream.pipe(res);
  } catch (err) {
    res.status(404).json({ error: 'Arquivo não encontrado.' });
  }
});

app.get('/api/photos', async (req, res) => {
  try {
    const objects = [];
    const stream = minioClient.listObjectsV2(MINIO_BUCKET, MINIO_PREFIX + '/', true);

    for await (const obj of stream) {
      if (!obj.name || obj.name.endsWith('/')) continue;
      objects.push({ name: obj.name, size: obj.size, lastModified: obj.lastModified });
    }

    const originals = objects.filter(o => !o.name.includes('/thumbs/'));
    const thumbNames = new Set(objects.filter(o => o.name.includes('/thumbs/')).map(o => o.name));

    originals.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));

    const items = originals.map((obj) => {
      const fileName = obj.name.replace(MINIO_PREFIX + '/', '');
      const thumbPath = `${MINIO_PREFIX}/thumbs/${fileName.replace(/\.[^.]+$/, '.jpg')}`;
      const hasThumb = thumbNames.has(thumbPath);
      return {
        name: obj.name,
        size: obj.size,
        lastModified: obj.lastModified,
        url: `/api/file?name=${encodeURIComponent(obj.name)}`,
        thumbUrl: hasThumb ? `/api/file?name=${encodeURIComponent(thumbPath)}` : null,
        kind: ALLOWED_TYPES.image.includes(typeByExt(obj.name)) ? 'image' : 'video'
      };
    });

    res.json({ items });
  } catch (err) {
    console.error('Erro ao listar fotos:', err);
    res.status(500).json({ error: 'Erro ao carregar a galeria.' });
  }
});

const typeByExt = (name) => {
  const ext = path.extname(String(name || '')).toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif', '.avif', '.bmp', '.tiff', '.tif'].includes(ext)) {
    return 'image/jpeg';
  }
  return 'video/mp4';
};

app.use((req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));

app.listen(PORT, () => {
  console.log(`Site do casamento rodando em http://localhost:${PORT}`);
});
