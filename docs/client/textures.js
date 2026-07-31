// Every texture in Splagoon is generated at runtime — no binary assets.
import * as THREE from 'three';

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

/* ------------------------------ ink splats ----------------------------- */

// Irregular blobs with satellite droplets. These are stamped into the paint
// render targets, so the alpha channel is what matters.
export function makeSplatMasks(count = 8, size = 160) {
  const list = [];
  for (let n = 0; n < count; n++) {
    const c = canvas(size);
    const g = c.getContext('2d');
    const cx = size / 2, cy = size / 2;
    const base = size * 0.33;
    const p1 = Math.random() * 6.28, p2 = Math.random() * 6.28, p3 = Math.random() * 6.28;
    const a1 = 0.14 + Math.random() * 0.16;
    const a2 = 0.08 + Math.random() * 0.12;

    g.fillStyle = '#fff';
    g.beginPath();
    const steps = 96;
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * Math.PI * 2;
      const r = base * (1 + a1 * Math.sin(3 * t + p1) + a2 * Math.sin(5 * t + p2) + 0.06 * Math.sin(9 * t + p3));
      const x = cx + Math.cos(t) * r, y = cy + Math.sin(t) * r;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.closePath();
    g.fill();

    // Droplets flung outward.
    const drops = 4 + Math.floor(Math.random() * 5);
    for (let i = 0; i < drops; i++) {
      const t = Math.random() * Math.PI * 2;
      const d = base * (1.05 + Math.random() * 0.55);
      const r = base * (0.07 + Math.random() * 0.16);
      const x = cx + Math.cos(t) * d, y = cy + Math.sin(t) * d;
      if (x - r < 1 || y - r < 1 || x + r > size - 1 || y + r > size - 1) continue;
      g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.fill();
      // little tail connecting the droplet back to the body
      g.beginPath();
      g.moveTo(cx + Math.cos(t) * base * 0.9, cy + Math.sin(t) * base * 0.9);
      g.lineTo(x + Math.cos(t + 1.57) * r * 0.5, y + Math.sin(t + 1.57) * r * 0.5);
      g.lineTo(x + Math.cos(t - 1.57) * r * 0.5, y + Math.sin(t - 1.57) * r * 0.5);
      g.closePath(); g.fill();
    }

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    list.push(tex);
  }
  return list;
}

/* ------------------------------ particles ------------------------------ */

export function makeDropletTexture(size = 64) {
  const c = canvas(size);
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.55, 'rgba(255,255,255,0.9)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function makeRingTexture(size = 128) {
  const c = canvas(size);
  const g = c.getContext('2d');
  g.strokeStyle = '#fff';
  g.lineWidth = size * 0.07;
  g.beginPath(); g.arc(size / 2, size / 2, size * 0.4, 0, 6.2832); g.stroke();
  g.globalAlpha = 0.4;
  g.lineWidth = size * 0.02;
  g.beginPath(); g.arc(size / 2, size / 2, size * 0.47, 0, 6.2832); g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ------------------------------ surfaces ------------------------------- */

// Value noise + speckle, used to keep large flat surfaces from looking dead.
export function makeSurfaceTexture(style) {
  const size = 256;
  const c = canvas(size);
  const g = c.getContext('2d');
  const palette = {
    deck:     ['#8a8f9c', '#7a808d'],
    plate:    ['#9aa3b2', '#848d9c'],
    metal:    ['#b9c2cf', '#98a2b1'],
    crate:    ['#c9a06a', '#b08a58'],
    spawn:    ['#8e93a2', '#787d8c'],
    plaza:    ['#c8c3d8', '#b4afc6'],
    tower:    ['#5c5580', '#4a4468'],
    building: ['#6e6699', '#5b5480'],
    portal:   ['#2b2450', '#1d1840'],
    shopA:    ['#d76a8f', '#c25679'],
    shopB:    ['#57b7c9', '#469aa9'],
    bounds:   ['#3a3560', '#2e2a4e'],
    concrete: ['#9b9bab', '#8a8a99'],
  }[style] || ['#9b9bab', '#8a8a99'];

  g.fillStyle = palette[0];
  g.fillRect(0, 0, size, size);

  // blotchy variation
  const blotchy = !['building', 'shopA', 'shopB', 'tower'].includes(style);
  for (let i = 0; i < (blotchy ? 220 : 70); i++) {
    const r = 6 + Math.random() * (blotchy ? 46 : 22);
    g.globalAlpha = (blotchy ? 0.05 : 0.02) + Math.random() * (blotchy ? 0.09 : 0.03);
    g.fillStyle = Math.random() < 0.5 ? palette[1] : '#ffffff';
    g.beginPath();
    g.arc(Math.random() * size, Math.random() * size, r, 0, 6.2832);
    g.fill();
  }
  // fine speckle
  g.globalAlpha = 1;
  const img = g.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 16;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);

  // panel seams for man-made styles
  if (['deck', 'plate', 'metal', 'spawn', 'plaza'].includes(style)) {
    g.globalAlpha = 0.22;
    g.strokeStyle = '#2a2a38';
    g.lineWidth = 2;
    const step = size / 4;
    for (let i = 0; i <= 4; i++) {
      g.beginPath(); g.moveTo(i * step, 0); g.lineTo(i * step, size); g.stroke();
      g.beginPath(); g.moveTo(0, i * step); g.lineTo(size, i * step); g.stroke();
    }
    g.globalAlpha = 1;
  }
  // Lit windows turn plain boxes into city buildings.
  if (['building', 'shopA', 'shopB', 'tower'].includes(style)) {
    const cols = 4, rows = 4;
    const pad = size * 0.09;
    const cw = (size - pad * 2) / cols, ch = (size - pad * 2) / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const lit = Math.random();
        g.globalAlpha = 1;
        g.fillStyle = lit > 0.55 ? '#ffe9a8' : (lit > 0.3 ? '#5c6ea8' : '#2a2b44');
        const x = pad + c * cw + cw * 0.16;
        const y = pad + r * ch + ch * 0.16;
        g.fillRect(x, y, cw * 0.68, ch * 0.5);
        g.globalAlpha = 0.35;
        g.fillStyle = '#14102a';
        g.fillRect(x, y + ch * 0.5, cw * 0.68, ch * 0.06);
      }
    }
    g.globalAlpha = 0.5;
    g.strokeStyle = '#221d3f';
    g.lineWidth = 3;
    for (let r = 0; r <= rows; r++) {
      g.beginPath(); g.moveTo(0, pad + r * ch); g.lineTo(size, pad + r * ch); g.stroke();
    }
    g.globalAlpha = 1;
  }

  if (style === 'crate') {
    g.globalAlpha = 0.35;
    g.strokeStyle = '#6a4f2c';
    g.lineWidth = 8;
    g.strokeRect(6, 6, size - 12, size - 12);
    g.beginPath(); g.moveTo(6, 6); g.lineTo(size - 6, size - 6); g.stroke();
    g.globalAlpha = 1;
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

/* -------------------------------- props -------------------------------- */

export function makeSignTexture(text, color = '#ff4d9d', w = 512, h = 160) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#100c24';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = color; g.lineWidth = 10;
  g.strokeRect(8, 8, w - 16, h - 16);
  g.fillStyle = color;
  g.font = `800 ${Math.floor(h * 0.55)}px 'Baloo 2', Trebuchet MS, sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = color; g.shadowBlur = 26;
  g.fillText(text, w / 2, h / 2 + 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function makeNameTexture(name, color = '#ffffff') {
  const w = 256, h = 64;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.font = "800 34px 'Baloo 2', Trebuchet MS, sans-serif";
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 8; g.strokeStyle = 'rgba(10,8,24,0.85)';
  g.strokeText(name, w / 2, h / 2);
  g.fillStyle = color;
  g.fillText(name, w / 2, h / 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function makeSkyTexture(top = '#1d3a63', bottom = '#7fd4e8') {
  const w = 8, h = 256;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, top);
  grd.addColorStop(0.55, mix(top, bottom, 0.55));
  grd.addColorStop(1, bottom);
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.mapping = THREE.EquirectangularReflectionMapping;
  return t;
}

function mix(a, b, t) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const r = Math.round(((pa >> 16) & 255) * (1 - t) + ((pb >> 16) & 255) * t);
  const g = Math.round(((pa >> 8) & 255) * (1 - t) + ((pb >> 8) & 255) * t);
  const bl = Math.round((pa & 255) * (1 - t) + (pb & 255) * t);
  return `rgb(${r},${g},${bl})`;
}
