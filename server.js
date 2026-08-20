require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const { Client, PostPolicy } = require('minio');

const app = express();
const PORT = process.env.PORT || 3000;

const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT || '127.0.0.1';
const MINIO_PORT = parseInt(process.env.MINIO_PORT || '9000', 10);
const MINIO_USE_SSL = (process.env.MINIO_USE_SSL || 'false') === 'true';
const MINIO_ACCESS_KEY = process.env.MINIO_ACCESS_KEY || '';
const MINIO_SECRET_KEY = process.env.MINIO_SECRET_KEY || '';
const MINIO_BUCKET = process.env.MINIO_BUCKET || 'wedding';
const MINIO_PREFIX = process.env.MINIO_PREFIX || 'uploads';
const MAX_FILE_MB = parseInt(process.env.MAX_FILE_MB || '200', 10);
const URL_EXPIRY = parseInt(process.env.URL_EXPIRY_SECONDS || (7 * 24 * 3600), 10);

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
  endPoint: MINIO_ENDPOINT,
  port: MINIO_PORT,
  useSSL: MINIO_USE_SSL,
  accessKey: MINIO_ACCESS_KEY,
  secretKey: MINIO_SECRET_KEY
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const randomId = () => crypto.randomBytes(6).toString('hex');
const dateStamp = () => new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);

app.post('/api/upload-url', async (req, res) => {
  try {
    const { name, type } = req.body || {};
    if (!isAllowed(type, name)) {
      return res.status(400).json({ error: 'Apenas fotos e vídeos são permitidos.' });
    }

    const safeName = path.basename(String(name || ''));
    const ext = path.extname(safeName).toLowerCase();
    const objectName = `${MINIO_PREFIX}/${dateStamp()}-${randomId()}${ext}`;

    const policy = new PostPolicy();
    policy.setBucket(MINIO_BUCKET);
    policy.setKey(objectName);
    policy.setExpires(new Date(Date.now() + 60 * 60 * 1000));
    policy.setContentType(type);
    policy.setContentLengthRange(1, MAX_FILE_MB * 1024 * 1024);

    const postURL = await minioClient.presignedPostPolicy(policy);
    res.json({ postURL, objectName });
  } catch (err) {
    console.error('Erro ao gerar URL de upload:', err);
    res.status(500).json({ error: 'Erro interno ao preparar o upload.' });
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

    objects.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));

    const items = await Promise.all(objects.map(async (obj) => {
      const url = await minioClient.presignedGetObject(MINIO_BUCKET, obj.name, URL_EXPIRY);
      return {
        name: obj.name,
        size: obj.size,
        lastModified: obj.lastModified,
        url,
        kind: ALLOWED_TYPES.image.includes(typeByExt(obj.name)) ? 'image' : 'video'
      };
    }));

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