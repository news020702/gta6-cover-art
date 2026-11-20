// Sunset Cover Studio — turn a photo and a caption into GTA-style cover art.
// A static, offline web app: every file it loads lives under app/ or is a data: URI.
// Photos are read on the user's own machine and never uploaded.

const SIZES = {
  square: { w: 1080, h: 1080, label: 'Square 1080 × 1080' },
  portrait: { w: 1080, h: 1350, label: 'Portrait 1080 × 1350' },
  wide: { w: 1920, h: 1080, label: 'Wide 1920 × 1080' },
};

const GRADES = {
  sunset: {
    name: 'Sunset',
    filter: 'saturate(1.28) contrast(1.06) brightness(1.02)',
    overlay: ['#ff7e3d', '#ff2e88', '#7b2ff7'],
    band: ['#2b0f45', '#ff2e88'],
    ink: '#fff3e0',
  },
  neon: {
    name: 'Neon',
    filter: 'saturate(1.45) contrast(1.1) hue-rotate(-8deg)',
    overlay: ['#00f0ff', '#ff2e88', '#7b2ff7'],
    band: ['#050510', '#b3126e'],
    ink: '#e8feff',
  },
  vice: {
    name: 'Vice',
    filter: 'saturate(1.35) contrast(1.05)',
    overlay: ['#00e5c7', '#ff5ea8', '#2b1a5e'],
    band: ['#06121f', '#0d5c4d'],
    ink: '#f2fffb',
  },
  mono: {
    name: 'Mono',
    filter: 'grayscale(1) contrast(1.15) brightness(1.05)',
    overlay: ['#ffffff', '#8a8a8a', '#111111'],
    band: ['#111111', '#4d4d4d'],
    ink: '#ffffff',
  },
};

const LAYOUTS = {
  hero2: {
    name: 'Hero + 2',
    rects(px, py, pw, ph, g) {
      const heroW = pw * 0.6 - g / 2;
      const colX = px + pw * 0.6 + g / 2;
      const colW = pw * 0.4 - g / 2;
      const halfH = ph / 2 - g / 2;
      return [
        { x: px, y: py, w: heroW, h: ph },
        { x: colX, y: py, w: colW, h: halfH },
        { x: colX, y: py + halfH + g, w: colW, h: halfH },
      ];
    },
  },
  hero3: {
    name: 'Hero + 3',
    rects(px, py, pw, ph, g) {
      const heroH = ph * 0.55 - g / 2;
      const rowY = py + ph * 0.55 + g / 2;
      const rowH = ph * 0.45 - g / 2;
      const cw = pw / 3 - (2 * g) / 3;
      return [
        { x: px, y: py, w: pw, h: heroH },
        { x: px, y: rowY, w: cw, h: rowH },
        { x: px + cw + g, y: rowY, w: cw, h: rowH },
        { x: px + 2 * cw + 2 * g, y: rowY, w: cw, h: rowH },
      ];
    },
  },
  grid: {
    name: 'Four panels',
    rects(px, py, pw, ph, g) {
      const cw = pw / 2 - g / 2;
      const ch = ph / 2 - g / 2;
      return [
        { x: px, y: py, w: cw, h: ch },
        { x: px + cw + g, y: py, w: cw, h: ch },
        { x: px, y: py + ch + g, w: cw, h: ch },
        { x: px + cw + g, y: py + ch + g, w: cw, h: ch },
      ];
    },
  },
};

const SAMPLES = [
  { id: 'sample-1', name: 'Sunset Suit', src: 'samples/sample-1.jpg' },
  { id: 'sample-2', name: 'Neon Night', src: 'samples/sample-2.jpg' },
  { id: 'sample-3', name: 'Bay City', src: 'samples/sample-3.jpg' },
];

const DEFAULT_PANELS = ['sample-1', 'sample-2', 'sample-3', 'sample-1'];

// The hero panel starts slightly pulled back and panned toward its subject,
// so a portrait face is not cut at the panel edge in tall covers.
const PANEL_DEFAULTS = [
  { zoom: 1.05, fx: 0.42, fy: 0.5 },
  { zoom: 1.15, fx: 0.5, fy: 0.5 },
  { zoom: 1.15, fx: 0.5, fy: 0.5 },
  { zoom: 1.15, fx: 0.5, fy: 0.5 },
];

const photos = new Map(); // id -> { img, name, kind }
let uploadCount = 0;

const state = {
  size: 'wide',
  layout: 'hero2',
  grade: 'sunset',
  caption: 'SUNSET HEIST',
  tagline: 'A STORY OF PALMS, NEON & FAST CARS',
  captionPos: 'bottom',
  captionScale: 1,
  ink: GRADES.sunset.ink,
  selected: 0,
  panels: DEFAULT_PANELS.map((photo, i) => ({ photo, ...PANEL_DEFAULTS[i] })),
};

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

// Geometry of one cover: the caption band and the panel rectangles, in pixels.
function coverGeometry(W, H) {
  const g = Math.max(8, Math.round(W * 0.009));
  const bandH = Math.round(H * 0.15);
  const band = state.captionPos === 'top'
    ? { x: 0, y: 0, w: W, h: bandH }
    : { x: 0, y: H - bandH, w: W, h: bandH };
  const area = state.captionPos === 'top'
    ? { x: 0, y: bandH, w: W, h: H - bandH }
    : { x: 0, y: 0, w: W, h: H - bandH };
  const px = area.x + g;
  const py = area.y + g;
  const pw = area.w - 2 * g;
  const ph = area.h - 2 * g;
  const rects = LAYOUTS[state.layout].rects(px, py, pw, ph, g);
  return { g, bandH, band, rects };
}

// Draw one photo into a panel rect, cover-fit, with zoom and pan.
// fx/fy (0..1) name the point of the image shown at the panel centre.
function drawPhotoInto(ctx, img, rect, zoom, fx, fy) {
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  if (!iw || !ih) return;
  const base = Math.max(rect.w / iw, rect.h / ih);
  const s = base * zoom;
  const dw = iw * s;
  const dh = ih * s;
  const minFx = dw > rect.w ? (rect.w / dw) / 2 : 0.5;
  const maxFx = dw > rect.w ? 1 - (rect.w / dw) / 2 : 0.5;
  const minFy = dh > rect.h ? (rect.h / dh) / 2 : 0.5;
  const maxFy = dh > rect.h ? 1 - (rect.h / dh) / 2 : 0.5;
  const cx = clamp(fx, minFx, maxFx);
  const cy = clamp(fy, minFy, maxFy);
  const dx = rect.x + rect.w / 2 - dw * cx;
  const dy = rect.y + rect.h / 2 - dh * cy;
  ctx.drawImage(img, dx, dy, dw, dh);
  return { dw, dh };
}

function drawPanel(ctx, rect, panel, grade, W) {
  const photo = photos.get(panel.photo);
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.clip();
  if (photo && photo.img && photo.img.complete && photo.img.naturalWidth) {
    ctx.filter = grade.filter;
    drawPhotoInto(ctx, photo.img, rect, panel.zoom, panel.fx, panel.fy);
    ctx.filter = 'none';
  } else {
    const fallback = ctx.createLinearGradient(rect.x, rect.y, rect.x + rect.w, rect.y + rect.h);
    fallback.addColorStop(0, '#3a2b52');
    fallback.addColorStop(1, '#171021');
    ctx.fillStyle = fallback;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  }
  // Sunset / neon wash over the photo.
  const wash = ctx.createLinearGradient(rect.x, rect.y, rect.x + rect.w, rect.y + rect.h);
  wash.addColorStop(0, grade.overlay[0]);
  wash.addColorStop(0.55, grade.overlay[1]);
  wash.addColorStop(1, grade.overlay[2]);
  ctx.globalAlpha = 0.16;
  ctx.globalCompositeOperation = 'overlay';
  ctx.fillStyle = wash;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  // Depth shading at the panel's foot.
  const shade = ctx.createLinearGradient(0, rect.y + rect.h * 0.6, 0, rect.y + rect.h);
  shade.addColorStop(0, 'rgba(0,0,0,0)');
  shade.addColorStop(1, 'rgba(0,0,0,0.22)');
  ctx.fillStyle = shade;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.restore();
  // Crisp white frame around the panel.
  ctx.lineWidth = Math.max(2, W * 0.002);
  ctx.strokeStyle = '#f7f2e8';
  ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
}

function fitCaptionFont(ctx, text, maxWidth, startSize) {
  let size = startSize;
  ctx.font = `${size}px Anton, sans-serif`;
  while (size > 12 && ctx.measureText(text).width > maxWidth) {
    size *= 0.92;
    ctx.font = `${size}px Anton, sans-serif`;
  }
  return size;
}

function drawCaptionBand(ctx, W, H, band, grade) {
  const bg = ctx.createLinearGradient(band.x, band.y, band.x + band.w, band.y + band.h);
  bg.addColorStop(0, grade.band[0]);
  bg.addColorStop(1, grade.band[1]);
  ctx.fillStyle = bg;
  ctx.fillRect(band.x, band.y, band.w, band.h);
  // Soft sun glow behind the title.
  const glow = ctx.createRadialGradient(
    band.x + band.w * 0.82, band.y + band.h * 0.5, 4,
    band.x + band.w * 0.82, band.y + band.h * 0.5, band.h * 0.95,
  );
  glow.addColorStop(0, grade.overlay[0]);
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = glow;
  ctx.fillRect(band.x, band.y, band.w, band.h);
  ctx.globalAlpha = 1;
  // Gold rule above the title.
  ctx.fillStyle = grade.overlay[0];
  const ruleY = band.y + band.h * 0.14;
  ctx.fillRect(band.x + W * 0.06, ruleY, W * 0.1, Math.max(2, H * 0.004));

  const title = (state.caption || 'UNTITLED').toUpperCase();
  const tagline = (state.tagline || '').toUpperCase();
  const cx = band.x + band.w / 2;
  const titleSize = fitCaptionFont(ctx, title, W * 0.9, band.h * 0.58 * state.captionScale);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${Math.max(1, titleSize * 0.02)}px`;
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = titleSize * 0.08;
  ctx.shadowOffsetY = titleSize * 0.03;
  ctx.lineWidth = Math.max(2, titleSize * 0.07);
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(20,5,30,0.65)';
  const titleY = tagline ? band.y + band.h * 0.42 : band.y + band.h * 0.52;
  ctx.strokeText(title, cx, titleY);
  ctx.fillStyle = state.ink;
  ctx.fillText(title, cx, titleY);
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  if (tagline) {
    const tagSize = Math.max(10, band.h * 0.15);
    ctx.font = `600 ${tagSize}px system-ui, sans-serif`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${Math.max(1, tagSize * 0.18)}px`;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText(tagline, cx, band.y + band.h * 0.8);
  }
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
}

function drawVignette(ctx, W, H) {
  const v = ctx.createRadialGradient(
    W / 2, H / 2, Math.min(W, H) * 0.42,
    W / 2, H / 2, Math.max(W, H) * 0.72,
  );
  v.addColorStop(0, 'rgba(10,0,20,0)');
  v.addColorStop(1, 'rgba(10,0,20,0.28)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);
}

// The whole cover, drawn at exactly W x H pixels. Deterministic: no random input.
function drawCover(ctx, W, H, st) {
  ctx.save();
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#f7f2e8';
  ctx.fillRect(0, 0, W, H);
  const grade = GRADES[st.grade];
  const { band, rects } = coverGeometry(W, H);
  rects.forEach((rect, i) => {
    drawPanel(ctx, rect, st.panels[i], grade, W);
  });
  drawCaptionBand(ctx, W, H, band, grade);
  drawVignette(ctx, W, H);
  ctx.restore();
}

// ---------- preview ----------

const preview = document.getElementById('preview');

function renderPreview() {
  const { w, h } = SIZES[state.size];
  const scale = 720 / Math.max(w, h);
  const pw = Math.round(w * scale);
  const ph = Math.round(h * scale);
  if (preview.width !== pw || preview.height !== ph) {
    preview.width = pw;
    preview.height = ph;
  }
  drawCover(preview.getContext('2d'), pw, ph, state);
  const status = document.getElementById('statusLine');
  if (status) {
    status.textContent = `${SIZES[state.size].label} · ${LAYOUTS[state.layout].name} · ${GRADES[state.grade].name} grade · click a panel to select it`;
  }
}

function currentPanelRects() {
  return coverGeometry(preview.width, preview.height).rects;
}

// ---------- export ----------

function renderExport(sizeKey) {
  const { w, h } = SIZES[sizeKey];
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  drawCover(c.getContext('2d'), w, h, state);
  return c;
}

function downloadCanvas(canvas, filename) {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }, 'image/png');
}

function exportOne() {
  const { w, h } = SIZES[state.size];
  downloadCanvas(renderExport(state.size), `cover-${state.size}-${w}x${h}.png`);
}

async function exportAll() {
  for (const key of Object.keys(SIZES)) {
    const { w, h } = SIZES[key];
    downloadCanvas(renderExport(key), `cover-${key}-${w}x${h}.png`);
    await new Promise((r) => setTimeout(r, 350));
  }
}

// ---------- photo library ----------

function thumbEl(photo, onClick) {
  const img = document.createElement('img');
  img.className = 'thumb';
  img.src = photo.img ? photo.img.src : '';
  img.alt = photo.name;
  img.title = photo.name;
  img.addEventListener('click', onClick);
  return img;
}

function renderPhotoLists() {
  const selectedPhoto = state.panels[state.selected].photo;
  const sampleBox = document.getElementById('sampleThumbs');
  const uploadBox = document.getElementById('uploadThumbs');
  const panelBox = document.getElementById('panelPhotos');
  [sampleBox, uploadBox, panelBox].forEach((box) => { if (box) box.replaceChildren(); });
  for (const [id, photo] of photos) {
    const el = thumbEl(photo, () => assignPhoto(id));
    if (id === selectedPhoto) el.classList.add('selected');
    if (photo.kind === 'sample') sampleBox.appendChild(el);
    else uploadBox.appendChild(el);
    const copy = thumbEl(photo, () => assignPhoto(id));
    if (id === selectedPhoto) copy.classList.add('selected');
    panelBox.appendChild(copy);
  }
}

function assignPhoto(id) {
  if (!photos.has(id)) return;
  state.panels[state.selected].photo = id;
  renderPhotoLists();
  renderPreview();
}

function loadSample(def) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      photos.set(def.id, { img, name: def.name, kind: 'sample' });
      resolve();
    };
    img.onerror = () => resolve();
    img.src = def.src;
  });
}

function loadUpload(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      uploadCount += 1;
      const id = `up-${uploadCount}`;
      photos.set(id, { img, name: file.name, kind: 'upload' });
      resolve(id);
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

// ---------- panel editing ----------

function syncPanelControls() {
  const panel = state.panels[state.selected];
  document.getElementById('panelName').textContent = String(state.selected + 1);
  document.getElementById('zoom').value = String(panel.zoom);
  document.getElementById('panX').value = String(panel.fx);
  document.getElementById('panY').value = String(panel.fy);
}

function selectPanel(i) {
  const count = currentPanelRects().length;
  state.selected = clamp(i, 0, count - 1);
  syncPanelControls();
  renderPhotoLists();
  renderPreview();
}

function setZoom(zoom) {
  state.panels[state.selected].zoom = clamp(zoom, 1, 2.5);
  renderPreview();
}

function setPan(fx, fy) {
  const panel = state.panels[state.selected];
  const rect = currentPanelRects()[state.selected];
  const photo = photos.get(panel.photo);
  if (!photo || !photo.img || !photo.img.naturalWidth || !rect) {
    panel.fx = clamp(fx, 0, 1);
    panel.fy = clamp(fy, 0, 1);
  } else {
    const base = Math.max(rect.w / photo.img.naturalWidth, rect.h / photo.img.naturalHeight);
    const dw = photo.img.naturalWidth * base * panel.zoom;
    const dh = photo.img.naturalHeight * base * panel.zoom;
    const minFx = dw > rect.w ? (rect.w / dw) / 2 : 0.5;
    const maxFx = dw > rect.w ? 1 - (rect.w / dw) / 2 : 0.5;
    const minFy = dh > rect.h ? (rect.h / dh) / 2 : 0.5;
    const maxFy = dh > rect.h ? 1 - (rect.h / dh) / 2 : 0.5;
    panel.fx = clamp(fx, minFx, maxFx);
    panel.fy = clamp(fy, minFy, maxFy);
  }
  document.getElementById('panX').value = String(panel.fx);
  document.getElementById('panY').value = String(panel.fy);
  renderPreview();
}

// Drag a panel's photo to move it; click a panel to select it.
function wirePreviewPointer() {
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let moved = false;

  function toCanvas(e) {
    const r = preview.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (preview.width / r.width),
      y: (e.clientY - r.top) * (preview.height / r.height),
    };
  }

  preview.addEventListener('pointerdown', (e) => {
    const p = toCanvas(e);
    const rects = currentPanelRects();
    const hit = rects.findIndex((r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h);
    if (hit < 0) return;
    if (hit !== state.selected) selectPanel(hit);
    dragging = true;
    moved = false;
    lastX = p.x;
    lastY = p.y;
    preview.classList.add('dragging');
    preview.setPointerCapture(e.pointerId);
  });

  preview.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const p = toCanvas(e);
    const dx = p.x - lastX;
    const dy = p.y - lastY;
    if (Math.abs(dx) + Math.abs(dy) > 1) moved = true;
    lastX = p.x;
    lastY = p.y;
    if (!moved) return;
    const panel = state.panels[state.selected];
    const rect = currentPanelRects()[state.selected];
    const photo = photos.get(panel.photo);
    if (!photo || !photo.img || !photo.img.naturalWidth || !rect) return;
    const base = Math.max(rect.w / photo.img.naturalWidth, rect.h / photo.img.naturalHeight);
    const dw = photo.img.naturalWidth * base * panel.zoom;
    const dh = photo.img.naturalHeight * base * panel.zoom;
    setPan(panel.fx - dx / dw, panel.fy - dy / dh);
  });

  const endDrag = () => {
    dragging = false;
    preview.classList.remove('dragging');
  };
  preview.addEventListener('pointerup', endDrag);
  preview.addEventListener('pointercancel', endDrag);
}

// ---------- controls ----------

function wireControls() {
  document.querySelectorAll('.size-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.size = btn.dataset.size;
      document.querySelectorAll('.size-btn').forEach((b) => b.classList.toggle('active', b === btn));
      renderPreview();
    });
  });

  document.querySelectorAll('#layoutRow .choice').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.layout = btn.dataset.layout;
      state.selected = 0;
      document.querySelectorAll('#layoutRow .choice').forEach((b) => b.classList.toggle('active', b === btn));
      syncPanelControls();
      renderPhotoLists();
      renderPreview();
    });
  });

  document.querySelectorAll('#gradeRow .choice').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.grade = btn.dataset.grade;
      state.ink = GRADES[state.grade].ink;
      document.querySelectorAll('#gradeRow .choice').forEach((b) => b.classList.toggle('active', b === btn));
      document.querySelectorAll('#inkRow .swatch').forEach((s) => {
        s.classList.toggle('active', s.dataset.ink === state.ink);
      });
      renderPreview();
    });
  });

  document.getElementById('caption').addEventListener('input', (e) => {
    state.caption = e.target.value;
    renderPreview();
  });
  document.getElementById('tagline').addEventListener('input', (e) => {
    state.tagline = e.target.value;
    renderPreview();
  });
  document.getElementById('captionPos').addEventListener('change', (e) => {
    state.captionPos = e.target.value;
    renderPreview();
  });
  document.getElementById('captionSize').addEventListener('input', (e) => {
    state.captionScale = Number(e.target.value);
    renderPreview();
  });
  document.querySelectorAll('#inkRow .swatch').forEach((sw) => {
    sw.addEventListener('click', () => {
      state.ink = sw.dataset.ink;
      document.querySelectorAll('#inkRow .swatch').forEach((s) => s.classList.toggle('active', s === sw));
      renderPreview();
    });
  });

  document.getElementById('zoom').addEventListener('input', (e) => setZoom(Number(e.target.value)));
  document.getElementById('panX').addEventListener('input', (e) => {
    setPan(Number(e.target.value), state.panels[state.selected].fy);
  });
  document.getElementById('panY').addEventListener('input', (e) => {
    setPan(state.panels[state.selected].fx, Number(e.target.value));
  });
  document.getElementById('resetCrop').addEventListener('click', () => {
    const panel = state.panels[state.selected];
    Object.assign(panel, PANEL_DEFAULTS[state.selected]);
    syncPanelControls();
    renderPreview();
  });

  document.getElementById('upload').addEventListener('change', async (e) => {
    const files = [...e.target.files].filter((f) => f.type.startsWith('image/'));
    let firstId = null;
    for (const file of files) {
      const id = await loadUpload(file);
      if (id && !firstId) firstId = id;
    }
    if (firstId) assignPhoto(firstId);
    else renderPhotoLists();
    e.target.value = '';
  });

  document.getElementById('exportOne').addEventListener('click', exportOne);
  document.getElementById('exportAll').addEventListener('click', exportAll);
}

// ---------- deterministic screenshots (?shot=) ----------

function applyShotParams() {
  const q = new URLSearchParams(location.search);
  if (!q.get('shot')) return;
  if (q.get('size') && SIZES[q.get('size')]) state.size = q.get('size');
  if (q.get('layout') && LAYOUTS[q.get('layout')]) state.layout = q.get('layout');
  if (q.get('grade') && GRADES[q.get('grade')]) {
    state.grade = q.get('grade');
    state.ink = GRADES[state.grade].ink;
  }
  if (q.get('caption') !== null) state.caption = q.get('caption');
  if (q.get('tagline') !== null) state.tagline = q.get('tagline');
  if (q.get('captionPos') === 'top' || q.get('captionPos') === 'bottom') {
    state.captionPos = q.get('captionPos');
  }
  if (q.get('photo')) {
    const ids = q.get('photo').split(',').map((s) => s.trim()).filter((id) => photos.has(id));
    if (ids.length) {
      state.panels.forEach((panel, i) => {
        panel.photo = ids[i % ids.length];
      });
    }
  }
  if (q.get('ink')) state.ink = q.get('ink');
  syncControlsFromState();
}

function syncControlsFromState() {
  document.querySelectorAll('.size-btn').forEach((b) => b.classList.toggle('active', b.dataset.size === state.size));
  document.querySelectorAll('#layoutRow .choice').forEach((b) => b.classList.toggle('active', b.dataset.layout === state.layout));
  document.querySelectorAll('#gradeRow .choice').forEach((b) => b.classList.toggle('active', b.dataset.grade === state.grade));
  document.getElementById('caption').value = state.caption;
  document.getElementById('tagline').value = state.tagline;
  document.getElementById('captionPos').value = state.captionPos;
  document.getElementById('captionSize').value = String(state.captionScale);
  document.querySelectorAll('#inkRow .swatch').forEach((s) => s.classList.toggle('active', s.dataset.ink === state.ink));
  syncPanelControls();
}

// ---------- boot ----------

async function boot() {
  wireControls();
  wirePreviewPointer();
  await Promise.all(SAMPLES.map(loadSample));
  applyShotParams();
  renderPhotoLists();
  syncPanelControls();
  try {
    await document.fonts.load('100px Anton');
    await document.fonts.ready;
  } catch (err) {
    // Fall back to a system sans if the bundled font cannot load.
  }
  renderPreview();
  renderPhotoLists();
  window.__shotReady = true;
}

// Test hooks: the export path and the live state, for the maker's own checks.
window.__exportPng = (sizeKey) => renderExport(sizeKey).toDataURL('image/png');
window.__studio = { state, SIZES, GRADES, LAYOUTS, renderPreview, renderExport };
window.__shotReady = false;

boot();
