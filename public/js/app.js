(function () {
  'use strict';

  const galleryEl = document.getElementById('gallery');
  const galleryCountEl = document.getElementById('gallery-count');
  const galleryEmptyEl = document.getElementById('gallery-empty');
  const uploadBtn = document.getElementById('upload-btn');
  const fileInput = document.getElementById('file-input');
  const uploadBar = document.querySelector('.upload-bar');
  const toastEl = document.getElementById('toast');

  let galleryItems = [];
  let galleryFingerprint = '';

  const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif', 'image/avif', 'image/bmp', 'image/tiff'];
  const VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/x-m4v', 'video/webm', 'video/x-msvideo', 'video/x-matroska', 'video/3gpp', 'video/mpeg'];

  const canPreview = (kind, name) => {
    const ext = (name.split('.').pop() || '').toLowerCase();
    if (kind === 'image') {
      return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp'].includes(ext);
    }
    return ['mp4', 'webm', 'mov', 'm4v', '3gp', 'mpeg', 'mpg', 'avi', 'mkv'].includes(ext);
  };

  function showToast(message, type) {
    toastEl.textContent = message;
    toastEl.className = 'toast show' + (type ? ' ' + type : '');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => {
      toastEl.classList.remove('show');
    }, 3500);
  }

  function skeletonItems(count) {
    return Array.from({ length: count }, (_, i) => {
      const div = document.createElement('div');
      div.className = 'gallery-item gallery-skeleton';
      div.style.animationDelay = (i % 6) * 0.1 + 's';
      return div;
    });
  }

  function buildItem(item) {
    const wrap = document.createElement('div');
    wrap.className = 'gallery-item';
    const baseName = item.name.split('/').pop();

    if (item.kind === 'image' && canPreview('image', baseName)) {
      const img = document.createElement('img');
      img.src = item.thumbUrl || item.url;
      img.alt = 'Foto enviada pelos convidados';
      img.loading = 'lazy';
      img.decoding = 'async';
      wrap.appendChild(img);
    } else if (item.kind === 'video' && canPreview('video', baseName)) {
      const video = document.createElement('video');
      video.src = item.url;
      video.muted = true;
      video.playsInline = true;
      video.preload = 'metadata';
      video.setAttribute('aria-label', 'Vídeo enviado pelos convidados');
      const badge = document.createElement('span');
      badge.className = 'play-badge';
      badge.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
      wrap.appendChild(video);
      wrap.appendChild(badge);
      wrap.addEventListener('click', () => {
        if (video.paused) {
          video.play().catch(() => {});
        } else {
          video.pause();
        }
      });
    } else {
      const badge = document.createElement('span');
      badge.className = 'file-badge';
      const isVideo = item.kind === 'video';
      badge.innerHTML =
        (isVideo
          ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M10 9l5 3-5 3z"/></svg>'
          : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>') +
        '<span>' + baseName + '</span>';
      wrap.appendChild(badge);
    }

    return wrap;
  }

  function computeFingerprint(items) {
    return items.length + ':' + (items[0] ? items[0].name : '') + ':' + (items[items.length - 1] ? items[items.length - 1].name : '');
  }

  async function loadGallery() {
    try {
      const res = await fetch('/api/photos');
      if (!res.ok) throw new Error();
      const data = await res.json();
      const newItems = data.items || [];
      const newFingerprint = computeFingerprint(newItems);
      if (newFingerprint === galleryFingerprint) return;
      galleryItems = newItems;
      galleryFingerprint = newFingerprint;
      renderGallery();
    } catch (err) {
      showToast('Não foi possível carregar a galeria.', 'error');
    }
  }

  function renderGallery() {
    galleryEl.innerHTML = '';
    galleryCountEl.textContent = galleryItems.length
      ? galleryItems.length + (galleryItems.length === 1 ? ' arquivo' : ' arquivos')
      : '';
    galleryEmptyEl.hidden = galleryItems.length > 0;

    const frag = document.createDocumentFragment();
    for (const item of galleryItems) {
      frag.appendChild(buildItem(item));
    }
    galleryEl.appendChild(frag);
  }

  function showSkeleton() {
    galleryEl.innerHTML = '';
    galleryCountEl.textContent = '';
    const frag = document.createDocumentFragment();
    for (const s of skeletonItems(9)) frag.appendChild(s);
    galleryEl.appendChild(frag);
  }

  /* ---------- Thumbnails ---------- */

  function generateThumbnail(file) {
    return new Promise((resolve) => {
      if (!file.type.startsWith('image/')) return resolve(null);

      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const size = 300;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        const scale = Math.max(size / img.width, size / img.height);
        const x = (size - img.width * scale) / 2;
        const y = (size - img.height * scale) / 2;
        ctx.drawImage(img, x, y, img.width * scale, img.height * scale);
        URL.revokeObjectURL(url);
        canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.8);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      img.src = url;
    });
  }

  /* ---------- Upload ---------- */

  const isImageFile = (file) => IMAGE_TYPES.includes(file.type);
  const isVideoFile = (file) => VIDEO_TYPES.includes(file.type);

  function validateFile(file) {
    if (!isImageFile(file) && !isVideoFile(file)) {
      return 'O arquivo "' + file.name + '" não é uma foto ou vídeo.';
    }
    return null;
  }

  function buildProgressUI(total) {
    const wrap = document.createElement('div');
    wrap.className = 'progress-wrap';
    wrap.innerHTML =
      '<div class="progress-info"><span>Enviando…</span><strong>0/' + total + '</strong></div>' +
      '<div class="progress-track"><div class="progress-fill"></div></div>';
    uploadBar.innerHTML = '';
    uploadBar.appendChild(wrap);
    return {
      wrap,
      nameEl: wrap.querySelector('span'),
      counterEl: wrap.querySelector('strong'),
      fillEl: wrap.querySelector('.progress-fill')
    };
  }

  async function getUploadKeys(name, type) {
    const res = await fetch('/api/upload-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, type })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Upload não permitido.');
    }
    return data;
  }

  function uploadFile(url, file, objectName) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable && xhr._onProgress) {
          xhr._onProgress(e.loaded / e.total);
        }
      });
      xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300);
      xhr.onerror = () => reject(new Error('Falha de rede ao enviar.'));
      const fd = new FormData();
      fd.append('file', file);
      fd.append('objectName', objectName);
      xhr.send(fd);
    });
  }

  async function handleFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;

    const rejected = [];
    const accepted = [];
    for (const f of files) {
      const err = validateFile(f);
      if (err) rejected.push(err);
      else accepted.push(f);
    }

    if (rejected.length) {
      showToast(rejected[0], 'error');
    }
    if (!accepted.length) return;

    uploadBtn.disabled = true;
    const ui = buildProgressUI(accepted.length);
    let done = 0;

    for (const file of accepted) {
      ui.nameEl.textContent = file.name;
      try {
        const { objectName, thumbObjectName } = await getUploadKeys(file.name, file.type);

        const upload = uploadFile('/api/upload', file, objectName);
        upload._onProgress = (p) => {
          const overall = (done + p) / accepted.length;
          ui.fillEl.style.width = Math.round(overall * 100) + '%';
        };
        const ok = await upload;

        if (ok) {
          done += 1;
          const thumbBlob = await generateThumbnail(file);
          if (thumbBlob && thumbObjectName) {
            uploadFile('/api/upload-thumb', thumbBlob, thumbObjectName).catch(() => {});
          }
        } else {
          showToast('Falha ao enviar "' + file.name + '".', 'error');
        }
        ui.counterEl.textContent = done + '/' + accepted.length;
        ui.fillEl.style.width = Math.round((done / accepted.length) * 100) + '%';
      } catch (err) {
        showToast(err.message || 'Erro ao enviar "' + file.name + '".', 'error');
      }
    }

    restoreUploadBar();
    uploadBtn.disabled = false;

    const ok = done;
    const failed = accepted.length - done;
    if (ok && !failed) {
      showToast(ok + (ok === 1 ? ' arquivo enviado com sucesso!' : ' arquivos enviados com sucesso!'), 'success');
    } else if (ok && failed) {
      showToast(ok + ' enviados, ' + failed + ' falharam. Tente novamente.', 'error');
    }

    if (ok) {
      refreshGallerySoon();
    }
  }

  function restoreUploadBar() {
    uploadBar.innerHTML = '';
    uploadBar.appendChild(uploadBtn);
    uploadBar.appendChild(fileInput);
  }

  function refreshGallerySoon() {
    galleryFingerprint = '';
    setTimeout(loadGallery, 1500);
  }

  /* ---------- Eventos ---------- */

  uploadBtn.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', () => {
    handleFiles(fileInput.files);
    fileInput.value = '';
  });

  /* ---------- Início ---------- */

  showSkeleton();
  loadGallery();
})();