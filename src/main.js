// City Screensaver — single-file canvas renderer
// Layers:
//   sky gradient + stars  → fixed
//   moon                   → slow drift
//   far skyline            → 0.20x parallax
//   mid skyline            → 0.45x parallax
//   near skyline           → 0.75x parallax
//   street                 → 1.00x parallax
// Sprites: blimp, cars — wrap horizontally
// Any asset missing on disk falls back to procedural placeholder.

const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d');
let W = 0, H = 0;

function resize() {
  W = canvas.width = window.innerWidth;
  H = canvas.height = window.innerHeight;
}
resize();
window.addEventListener('resize', resize);

// ─────────────────────────────────────────────
// Asset loader — missing files are skipped silently
// ─────────────────────────────────────────────
const assets = {};
const manifest = {
  moon:         'assets/moon.png',
  skylineFar:   'assets/skyline-far.png',
  skylineMid:   'assets/skyline-mid.png',
  skylineNear:  'assets/skyline-near.png',
  street:       'assets/street.png',
  blimp:        'assets/blimp.png',
  car1:         'assets/car-1.png',
  car2:         'assets/car-2.png',
  car3:         'assets/car-3.png',
  cloud:        'assets/cloud.png',
  deliveryBot:  'assets/delivery-bot.png',
  drone:        'assets/drone.png',
  streetcar:    'assets/streetcar.png',
};

function loadAssets() {
  return Promise.all(Object.entries(manifest).map(([key, src]) =>
    new Promise(resolve => {
      const img = new Image();
      img.onload = () => { assets[key] = img; resolve(); };
      img.onerror = () => resolve();
      img.src = src;
    })
  ));
}

// ─────────────────────────────────────────────
// Tiny utilities
// ─────────────────────────────────────────────
function rand(seed) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function drawTiled(img, scrollX, y, targetH) {
  // scrollX is in screen-space pixels (i.e., already multiplied by the parallax factor).
  const scale = targetH / img.height;
  const tileW = img.width * scale;
  let x = -(((scrollX % tileW) + tileW) % tileW);
  while (x < W) {
    ctx.drawImage(img, x, y, tileW, targetH);
    x += tileW;
  }
}

// ─────────────────────────────────────────────
// Stars — twinkle, very slow parallax
// ─────────────────────────────────────────────
const stars = Array.from({ length: 220 }, () => ({
  x: Math.random() * 4000,
  yFrac: Math.random() * 0.55,
  size: Math.random() < 0.08 ? 2 : 1,
  twinkle: Math.random() * Math.PI * 2,
}));

function drawStars(time, camera) {
  ctx.fillStyle = '#fff';
  for (const s of stars) {
    const sx = (((s.x - camera * 0.04) % W) + W) % W;
    const sy = s.yFrac * H;
    const a = 0.4 + 0.6 * Math.sin(time * 0.001 + s.twinkle);
    ctx.globalAlpha = a;
    ctx.fillRect(sx, sy, s.size, s.size);
  }
  ctx.globalAlpha = 1;
}

// ─────────────────────────────────────────────
// Procedural skyline — fallback when no PNG provided
// ─────────────────────────────────────────────
function drawProceduralSkyline({ scrollX, baseY, maxH, color, buildingW, seed, lit, windowColor }) {
  const start = Math.floor(scrollX / buildingW);
  const end = start + Math.ceil(W / buildingW) + 2;

  for (let i = start; i < end; i++) {
    const r1 = rand(i + seed);
    const r2 = rand(i * 2.3 + seed * 7);
    const h = maxH * (0.3 + r1 * 0.7);
    const w = buildingW * (0.65 + r2 * 0.35);
    const x = i * buildingW - scrollX;
    const top = baseY - h;

    ctx.fillStyle = color;
    ctx.fillRect(x, top, w, h);

    if (lit) {
      ctx.fillStyle = windowColor;
      const gapX = 11, gapY = 14, winW = 4, winH = 6;
      for (let wy = top + 12; wy < baseY - 8; wy += gapY) {
        for (let wx = x + 5; wx < x + w - winW - 2; wx += gapX) {
          const r = rand(Math.floor(wx) * 0.13 + Math.floor(wy) * 0.37 + i * 91 + seed);
          if (r > 0.55) ctx.fillRect(wx, wy, winW, winH);
        }
      }
    }
  }
}

// ─────────────────────────────────────────────
// Floating sprite (blimp, cars, clouds)
// ─────────────────────────────────────────────
class FloatingSprite {
  // `width` is the on-screen target width in CSS pixels; height preserves aspect ratio.
  // `fallbackSize` controls the wrap math when no image has loaded yet.
  // `wheels` (optional) is an array of {xFrac, yFrac, rFrac} positions inside
  // the bounding box; if set, spinning spokes are drawn on top each frame.
  constructor({ asset, yFrac, speed, width = 120, fallback, fallbackSize = 80, wheels = null, screen = null }) {
    this.asset = asset;
    this.yFrac = yFrac;
    this.speed = speed;
    this.width = width;
    this.fallback = fallback;
    this.fallbackSize = fallbackSize;
    this.wheels = wheels;
    this.wheelAngle = 0;
    this.screen = screen;  // optional { xFrac, yFrac, wFrac, hFrac, content } in bbox space
    this.x = Math.random() * (W + 400) - 200;
  }

  _size() {
    const img = assets[this.asset];
    if (!img) return { w: this.fallbackSize, h: this.fallbackSize };
    const w = this.width;
    const h = img.height * (this.width / img.width);
    return { w, h };
  }

  update(dt) {
    this.x += this.speed * dt;
    const { w } = this._size();
    if (this.speed > 0 && this.x > W + 200) this.x = -w - 100;
    if (this.speed < 0 && this.x < -w - 200) this.x = W + 100;
    if (this.wheels) {
      // Sign of speed sets rotation direction; magnitude sets rate (boosted for visual effect).
      this.wheelAngle += this.speed * dt * 0.10;
    }
  }

  render() {
    const img = assets[this.asset];
    const y = this.yFrac * H;
    if (img) {
      const { w, h } = this._size();
      if (this.speed < 0) {
        ctx.save();
        ctx.translate(this.x + w, y);
        ctx.scale(-1, 1);
        ctx.drawImage(img, 0, 0, w, h);
        ctx.restore();
      } else {
        ctx.drawImage(img, this.x, y, w, h);
      }
      if (this.wheels) {
        for (const wheel of this.wheels) {
          const cx = this.x + w * wheel.xFrac;
          const cy = y + h * wheel.yFrac;
          const r = w * wheel.rFrac;
          drawSpinningSpokes(cx, cy, r, this.wheelAngle);
        }
      }
    } else if (this.fallback) {
      this.fallback(this.x, y, this.speed < 0);
    }
  }
}

// Spinning wheel overlay — draws a bright rotating gleam plus 3 dark spokes.
// Bright neon gleam against any wheel color makes the rotation immediately
// readable; dark spokes add motion-blur weight on top of the original hubcap.
function drawSpinningSpokes(cx, cy, r, angle) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  // Dark spokes (3, evenly spaced) — bottom layer, contained within wheel
  ctx.fillStyle = 'rgba(8, 4, 16, 0.9)';
  for (let i = 0; i < 3; i++) {
    ctx.save();
    ctx.rotate(i * (Math.PI * 2 / 3));
    ctx.fillRect(-r * 0.13, -r * 0.85, r * 0.26, r * 0.72);
    ctx.restore();
  }
  // Bright gleam — a single neon-white streak rotating at outer radius
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.fillRect(-r * 0.10, -r * 0.82, r * 0.20, r * 0.42);
  // Soft cyan halo on the gleam
  const grad = ctx.createRadialGradient(0, -r * 0.65, 0, 0, -r * 0.65, r * 0.45);
  grad.addColorStop(0, 'rgba(92, 243, 255, 0.55)');
  grad.addColorStop(1, 'rgba(92, 243, 255, 0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(0, -r * 0.65, r * 0.45, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ─────────────────────────────────────────────
// Procedural sprite fallbacks (drawn until assets load)
// ─────────────────────────────────────────────
function drawCarFallback(color, accent) {
  return (x, y, flipped) => {
    const f = flipped ? -1 : 1;
    const ox = flipped ? 36 : 0;
    ctx.save();
    ctx.translate(x + ox, y);
    ctx.scale(f, 1);
    // body
    ctx.fillStyle = color;
    ctx.fillRect(0, 6, 36, 10);
    ctx.fillRect(8, 0, 20, 8);
    // wheels
    ctx.fillStyle = '#111';
    ctx.fillRect(4, 14, 6, 4);
    ctx.fillRect(26, 14, 6, 4);
    // headlight
    ctx.fillStyle = '#fff2a8';
    ctx.fillRect(34, 9, 2, 4);
    // window
    ctx.fillStyle = accent;
    ctx.fillRect(10, 2, 16, 4);
    ctx.restore();
  };
}

function drawBlimpFallback(x, y) {
  ctx.fillStyle = '#c4374e';
  ctx.beginPath();
  ctx.ellipse(x + 50, y + 16, 50, 14, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#222';
  ctx.fillRect(x + 38, y + 30, 24, 6);
  ctx.fillStyle = '#fff8c4';
  ctx.fillRect(x + 44, y + 32, 3, 2);
  ctx.fillRect(x + 52, y + 32, 3, 2);
}

function drawCloudFallback(x, y) {
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.beginPath();
  ctx.ellipse(x + 60, y + 20, 60, 18, 0, 0, Math.PI * 2);
  ctx.ellipse(x + 30, y + 24, 30, 12, 0, 0, Math.PI * 2);
  ctx.ellipse(x + 90, y + 24, 35, 14, 0, 0, Math.PI * 2);
  ctx.fill();
}

// ─────────────────────────────────────────────
// Scene
// ─────────────────────────────────────────────
const CAMERA_SPEED = 10; // px/sec — slow ambient pan
let camera = 0;
const sprites = [];

function buildSprites() {
  sprites.length = 0;

  // Wispy fog drifting through the upper sky
  sprites.push(new FloatingSprite({
    asset: 'cloud', yFrac: 0.08, speed: 4, width: 420,
    fallback: drawCloudFallback,
  }));
  sprites.push(new FloatingSprite({
    asset: 'cloud', yFrac: 0.20, speed: 6, width: 300,
    fallback: drawCloudFallback,
  }));

  // CURSOR blimp drifts above the mid skyline
  sprites.push(new FloatingSprite({
    asset: 'blimp', yFrac: 0.16, speed: 14, width: 200,
    fallback: drawBlimpFallback,
  }));

  // Cars in 3 lanes, one per lane — guaranteed no overlap.
  // Wheel positions measured per-asset from the bg-removed source PNGs.
  // The bg-removed cars have ~30% transparent padding below the visible car,
  // so wheels live in the lower-middle of the bounding box (not the bottom).
  // yFrac (car on screen) is tuned so each car's wheels land on the matching lane.
  sprites.push(new FloatingSprite({
    asset: 'car1', yFrac: 0.76, speed: 70, width: 140,   // Waymo, lane 1 (back), going right
    fallback: drawCarFallback('#ff2b8a', '#1a0426'),
    wheels: [
      { xFrac: 0.188, yFrac: 0.598, rFrac: 0.052 },
      { xFrac: 0.816, yFrac: 0.591, rFrac: 0.055 },
    ],
  }));
  sprites.push(new FloatingSprite({
    asset: 'car2', yFrac: 0.82, speed: -55, width: 150,  // Cybertruck, lane 2 (mid), going left
    fallback: drawCarFallback('#5cf3ff', '#1a0426'),
    wheels: [
      { xFrac: 0.163, yFrac: 0.557, rFrac: 0.046 },
      { xFrac: 0.803, yFrac: 0.557, rFrac: 0.049 },
    ],
  }));
  // Streetcar replaces Model S in lane 3 (front). Wheels are placeholders —
  // refine with D-key calibration.
  sprites.push(new FloatingSprite({
    asset: 'streetcar', yFrac: 0.78, speed: 38, width: 260,
    fallback: null,
    wheels: [
      { xFrac: 0.257, yFrac: 0.736, rFrac: 0.020 },
      { xFrac: 0.703, yFrac: 0.742, rFrac: 0.020 },
    ],
    screen: { xFrac: 0.889, yFrac: 0.377, wFrac: 0.072, hFrac: 0.033, content: 'F MARKET' },
  }));

  // Delivery bot rolls along the sidewalk
  sprites.push(new FloatingSprite({
    asset: 'deliveryBot', yFrac: 0.70, speed: 22, width: 90,
    screen: { xFrac: 0.389, yFrac: 0.124, wFrac: 0.278, hFrac: 0.191, content: 'BOT-7' },
  }));
  // Drone hovers above the buildings
  sprites.push(new FloatingSprite({
    asset: 'drone', yFrac: 0.34, speed: 12, width: 160,
    screen: { xFrac: 0.224, yFrac: 0.564, wFrac: 0.556, hFrac: 0.250, content: 'DELIVERY' },
  }));
}

// ─────────────────────────────────────────────
// Render
// ─────────────────────────────────────────────
function update(dt) {
  if (logoCal.on || entityCal.on || wheelCal.on) return; // paused during any trace mode
  camera += CAMERA_SPEED * dt;
  for (const s of sprites) s.update(dt);
}

function render(time) {
  // Sky — synthwave sunset gradient
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0.00, '#0a0220');
  grad.addColorStop(0.35, '#2a0a4a');
  grad.addColorStop(0.65, '#6d1565');
  grad.addColorStop(0.85, '#d83a7e');
  grad.addColorStop(1.00, '#ff6b3d');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  drawStars(time, camera);

  // Moon — fixed position; the camera pan already provides motion in the scene
  const moonX = W * 0.72;
  const moonY = H * 0.18;
  if (assets.moon) {
    const s = 180;
    ctx.drawImage(assets.moon, moonX - s / 2, moonY - s / 2, s, s);
  } else {
    // soft glow
    const r = 42;
    const glow = ctx.createRadialGradient(moonX, moonY, r * 0.4, moonX, moonY, r * 2.2);
    glow.addColorStop(0, 'rgba(255, 244, 214, 0.55)');
    glow.addColorStop(1, 'rgba(255, 244, 214, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(moonX - r * 2.2, moonY - r * 2.2, r * 4.4, r * 4.4);
    ctx.fillStyle = '#fff4d6';
    ctx.beginPath();
    ctx.arc(moonX, moonY, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Cloud sprites (rendered before skylines — sit behind buildings)
  for (let i = 0; i < 2; i++) sprites[i].render();

  // Blimp — between far and mid layer feels right
  // (rendered with skylines below for proper z-order)

  const groundY = H * 0.78;
  const streetH = H - groundY;
  const sidewalkH = streetH * 0.22;
  const roadTop = groundY + sidewalkH;
  const roadH = H - roadTop;

  // Far skyline — darkest purple, cyan windows
  if (assets.skylineFar) {
    drawTiled(assets.skylineFar, camera * 0.20, groundY - H * 0.32, H * 0.32);
  } else {
    drawProceduralSkyline({
      scrollX: camera * 0.20,
      baseY: groundY,
      maxH: H * 0.28,
      color: '#1a0a35',
      buildingW: 64,
      seed: 1.1,
      lit: true,
      windowColor: 'rgba(120, 220, 255, 0.55)',
    });
  }

  // Blimp drifts in front of far layer
  sprites[2].render();

  // Mid skyline — magenta-tinted, pink windows
  if (assets.skylineMid) {
    drawTiled(assets.skylineMid, camera * 0.45, groundY - H * 0.42, H * 0.42);
  } else {
    drawProceduralSkyline({
      scrollX: camera * 0.45,
      baseY: groundY,
      maxH: H * 0.38,
      color: '#0e0426',
      buildingW: 96,
      seed: 2.3,
      lit: true,
      windowColor: '#ff5fb8',
    });
  }

  // Near skyline — near-black silhouettes with electric cyan/pink windows
  if (assets.skylineNear) {
    drawTiled(assets.skylineNear, camera * 0.75, groundY - H * 0.50, H * 0.50);
  } else {
    drawProceduralSkyline({
      scrollX: camera * 0.75,
      baseY: groundY,
      maxH: H * 0.48,
      color: '#05010f',
      buildingW: 140,
      seed: 3.7,
      lit: true,
      windowColor: '#5cf3ff',
    });
  }

  // Sidewalk — dark purple slab with neon curb edges
  ctx.fillStyle = '#1a1130';
  ctx.fillRect(0, groundY, W, sidewalkH);
  // Curb top (against buildings) — magenta
  ctx.fillStyle = 'rgba(255, 95, 184, 0.75)';
  ctx.fillRect(0, groundY, W, 2);
  // Curb bottom (against road) — cyan
  ctx.fillStyle = 'rgba(92, 243, 255, 0.85)';
  ctx.fillRect(0, roadTop - 2, W, 2);
  // Paving slab seams, drift with camera
  ctx.fillStyle = 'rgba(92, 243, 255, 0.12)';
  const slabW = 90;
  let sx = -(((camera) % slabW + slabW) % slabW);
  while (sx < W) {
    ctx.fillRect(sx, groundY + 4, 1, sidewalkH - 8);
    sx += slabW;
  }

  // Road — black asphalt
  ctx.fillStyle = '#040209';
  ctx.fillRect(0, roadTop, W, roadH);
  // Two dashed lane dividers (3 lanes)
  for (let lane = 1; lane <= 2; lane++) {
    const stripeY = roadTop + (roadH * lane) / 3;
    ctx.fillStyle = lane === 1 ? 'rgba(255, 217, 80, 0.85)' : 'rgba(255, 217, 80, 0.85)';
    const dashW = 38, dashGap = 28, total = dashW + dashGap;
    let dx = -(((camera * 1.0) % total + total) % total);
    while (dx < W) {
      ctx.fillRect(dx, stripeY - 1, dashW, 2);
      dx += total;
    }
  }

  // Cars on the road
  for (let i = 3; i < sprites.length; i++) sprites[i].render();

  // Expose scene geometry for HTML overlay layers
  if (assets.skylineNear) {
    const targetH = H * 0.50;
    const scale = targetH / assets.skylineNear.height;
    const tileW = assets.skylineNear.width * scale;
    const tileTopY = groundY - targetH;
    window._scene = {
      groundY, sidewalkH, roadTop, roadH,
      skylineNear: { tileW, tileH: targetH, tileTopY, scrollX: camera * 0.75 },
    };
  } else {
    window._scene = { groundY, sidewalkH, roadTop, roadH };
  }

  // Trace overlays (drawn last, on top of everything)
  if (logoCal.on) drawLogoTraceOverlay();
  if (entityCal.on) drawEntityTraceOverlay();
  if (wheelCal.on) drawWheelCalOverlay();
}

// ─────────────────────────────────────────────
// HTML billboards — parallax-scroll with camera, foreground layer
// ─────────────────────────────────────────────
const billboardEls = Array.from(document.querySelectorAll('.billboard'));

function updateBillboards() {
  if (billboardEls.length === 0) return;
  const period = W + 600;
  for (let i = 0; i < billboardEls.length; i++) {
    const baseOffset = (i / billboardEls.length) * period;
    let x = baseOffset - camera; // parallax = 1.0 (foreground, matches sidewalk)
    x = ((x + 300) % period + period) % period - 300;
    billboardEls[i].style.transform = `translateX(${x}px)`;
  }
}

const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function updateClock() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const t = document.getElementById('bb-time');
  const d = document.getElementById('bb-date');
  if (t) t.textContent = `${hh}:${mm}`;
  if (d) d.textContent = `${DAYS[now.getDay()]} ${MONTHS[now.getMonth()]} ${now.getDate()}`;
}
updateClock();
setInterval(updateClock, 1000);

// ─────────────────────────────────────────────
// Main loop
// ─────────────────────────────────────────────
let last = performance.now();
function loop(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  update(dt);
  render(now);
  updateBillboards();
  updateBuildingOverlays();
  updateEntityDisplays();
  requestAnimationFrame(loop);
}

loadAssets().then(() => {
  buildSprites();
  requestAnimationFrame(loop);
});

// ─────────────────────────────────────────────
// Building logo overlays — HTML divs positioned over the skyline-near layer.
// Each slot is a region in source-image coordinates (0..1 of the image).
// Slots cycle: sometimes show the original PNG underneath (passive), sometimes
// show HTML content covering it (active). One DOM element per visible tile.
// ─────────────────────────────────────────────
const LOGO_SLOTS = [
  { id: 'slot-1', xFrac: 0.814, yFrac: 0.251, wFrac: 0.152, hFrac: 0.124, content: 'CLAUDE 4.7' },
  { id: 'slot-3', xFrac: 0.250, yFrac: 0.556, wFrac: 0.058, hFrac: 0.084, content: 'S26' },
  { id: 'slot-4', xFrac: 0.566, yFrac: 0.528, wFrac: 0.109, hFrac: 0.047, content: 'ASK ME' },
  { id: 'slot-5', xFrac: 0.708, yFrac: 0.601, wFrac: 0.083, hFrac: 0.047, content: 'v0' },
];

const MAX_TILES = 5; // upper bound on simultaneously-visible tiles (extra buffer for assignment)
const buildingOverlaysRoot = document.getElementById('building-overlays');
const slotEls = new Map(); // slot.id -> HTMLElement[]

// Per-slot rotating content list. Each visible tile-instance pulls from this when it enters.
const SLOT_CONTENTS = {
  'slot-1': ['CLAUDE 4.7', 'OPUS 4.7', 'CLAUDE CODE', 'CLAUDE PRO', 'SONNET'],
  'slot-3': ['S26 BATCH', 'YC W26', 'APPLY NOW', 'DEMO DAY', 'INVEST'],
  'slot-4': ['ASK ME', 'PERPLEX.AI', 'SEARCH AI', '★ ASK', 'ANSWERS'],
  'slot-5': ['v0', 'AI SDK', 'NEXT 16', 'VERCEL', 'DEPLOY'],
};
const slotRotIdx = new Map(LOGO_SLOTS.map(s => [s.id, 0]));

function pickNextContent(slotId, fallback) {
  const rotation = SLOT_CONTENTS[slotId];
  if (!rotation || rotation.length === 0) return fallback;
  const i = slotRotIdx.get(slotId);
  slotRotIdx.set(slotId, (i + 1) % rotation.length);
  return rotation[i];
}

// slot.id -> Map<absoluteTileIdx, { content, active, el }>
// Instances persist while visible; deleted when off-screen so the next entry picks new content.
const slotInstances = new Map();
for (const slot of LOGO_SLOTS) {
  slotInstances.set(slot.id, new Map());
  const els = [];
  for (let i = 0; i < MAX_TILES; i++) {
    const el = document.createElement('div');
    el.className = 'building-logo-overlay';
    el.dataset.slot = slot.id;
    buildingOverlaysRoot.appendChild(el);
    els.push(el);
  }
  slotEls.set(slot.id, els);
}

function updateBuildingOverlays() {
  const s = window._scene;
  if (!s || !s.skylineNear) return;
  const { tileW, tileH, tileTopY, scrollX } = s.skylineNear;

  // Visible range of absolute tile indices (a small buffer of 1 on each side so
  // an instance is "off-screen" only when its tile is clearly out of view).
  const firstAbs = Math.floor(scrollX / tileW) - 1;
  const lastAbs = firstAbs + Math.ceil(W / tileW) + 3;
  const visible = new Set();
  for (let a = firstAbs; a <= lastAbs; a++) visible.add(a);

  for (const slot of LOGO_SLOTS) {
    const els = slotEls.get(slot.id);
    const instances = slotInstances.get(slot.id);

    // Drop instances that have left the visible range — their DOM elements free up.
    for (const absIdx of [...instances.keys()]) {
      if (!visible.has(absIdx)) {
        const inst = instances.get(absIdx);
        if (inst.el) {
          inst.el.classList.remove('is-active');
          inst.el.dataset.absIdx = '';
        }
        instances.delete(absIdx);
      }
    }

    // Track which DOM elements are already in use this frame
    const usedEls = new Set();
    for (const inst of instances.values()) if (inst.el) usedEls.add(inst.el);

    // For each visible absolute tile that doesn't yet have an instance: create one,
    // pick fresh content + active state, assign a free DOM element.
    for (const absIdx of visible) {
      if (instances.has(absIdx)) continue;
      let freeEl = null;
      for (const candidate of els) {
        if (!usedEls.has(candidate)) { freeEl = candidate; break; }
      }
      if (!freeEl) continue; // pool exhausted (shouldn't happen with MAX_TILES=5)
      usedEls.add(freeEl);
      instances.set(absIdx, {
        content: pickNextContent(slot.id, slot.content),
        active: Math.random() > 0.25, // ~75% show HTML; ~25% show original PNG
        el: freeEl,
      });
    }

    // Position every active instance + apply active class. Logo-trace mode hides them all.
    for (const el of els) el.classList.remove('is-active');
    for (const [absIdx, inst] of instances) {
      if (!inst.el) continue;
      const tileLeftX = absIdx * tileW - scrollX;
      const x = tileLeftX + slot.xFrac * tileW;
      const y = tileTopY + slot.yFrac * tileH;
      const w = slot.wFrac * tileW;
      const h = slot.hFrac * tileH;
      inst.el.style.transform = `translate(${x}px, ${y}px)`;
      inst.el.style.width = `${w}px`;
      inst.el.style.height = `${h}px`;
      inst.el.style.fontSize = `${Math.max(8, Math.min(20, h * 0.5))}px`;
      inst.el.textContent = inst.content;
      if (inst.active && !logoCal.on) inst.el.classList.add('is-active');
    }
  }
}

// ─────────────────────────────────────────────
// Logo trace tool (press B to toggle)
// Lets the user click+drag on the leftmost visible skyline tile to define
// logo-slot rectangles. Outputs xFrac/yFrac/wFrac/hFrac to clipboard.
// ─────────────────────────────────────────────
const logoCal = {
  on: false,
  rects: [],            // [{ xFrac, yFrac, wFrac, hFrac, id }]
  draftStart: null,     // {x, y} on canvas while dragging a new rect
  draftCurrent: null,   // current cursor pos while dragging a new rect
  selected: -1,         // index into rects
  drag: null,           // { idx, mode: 'move' | 'resize-br', startMx, startMy, orig }
  hover: -1,
};

const logoCalPanel = document.getElementById('logo-cal-panel');
const logoCalValues = document.getElementById('logo-cal-values');

function logoSnapCamera() {
  // Snap camera so skyline-near tile 0 aligns to x=0 on screen.
  // The skyline scrolls at 0.75 * camera, so to make scrollX a multiple of tileW,
  // set camera = (tileW * k) / 0.75 for some integer k. Easiest: camera = 0.
  camera = 0;
}

function leftmostTileGeom() {
  const s = window._scene;
  if (!s || !s.skylineNear) return null;
  const { tileW, tileH, tileTopY, scrollX } = s.skylineNear;
  const startX = -(((scrollX % tileW) + tileW) % tileW);
  return { x0: startX, y0: tileTopY, w: tileW, h: tileH };
}

function screenToFrac(mx, my) {
  const g = leftmostTileGeom();
  if (!g) return null;
  return {
    xFrac: (mx - g.x0) / g.w,
    yFrac: (my - g.y0) / g.h,
  };
}

function fracToScreen(xFrac, yFrac) {
  const g = leftmostTileGeom();
  if (!g) return null;
  return { x: g.x0 + xFrac * g.w, y: g.y0 + yFrac * g.h };
}

function hitTestRect(mx, my) {
  // Returns { idx, mode }. Mode is 'resize-br' near bottom-right corner, 'move' inside, null otherwise.
  for (let i = logoCal.rects.length - 1; i >= 0; i--) {
    const r = logoCal.rects[i];
    const a = fracToScreen(r.xFrac, r.yFrac);
    const b = fracToScreen(r.xFrac + r.wFrac, r.yFrac + r.hFrac);
    if (!a || !b) continue;
    const distBR = Math.hypot(mx - b.x, my - b.y);
    if (distBR < 10) return { idx: i, mode: 'resize-br' };
    if (mx >= a.x && mx <= b.x && my >= a.y && my <= b.y) return { idx: i, mode: 'move' };
  }
  return { idx: -1, mode: null };
}

function drawLogoTraceOverlay() {
  const g = leftmostTileGeom();
  if (!g) return;
  ctx.save();
  // Highlight the leftmost tile boundary
  ctx.strokeStyle = 'rgba(255, 226, 122, 0.7)';
  ctx.setLineDash([6, 4]);
  ctx.lineWidth = 1;
  ctx.strokeRect(g.x0, g.y0, g.w, g.h);
  ctx.setLineDash([]);
  // Existing rects
  logoCal.rects.forEach((r, i) => {
    const a = fracToScreen(r.xFrac, r.yFrac);
    const b = fracToScreen(r.xFrac + r.wFrac, r.yFrac + r.hFrac);
    const w = b.x - a.x, h = b.y - a.y;
    const isSel = i === logoCal.selected;
    const isHover = !isSel && i === logoCal.hover;
    ctx.strokeStyle = isSel ? '#ff2b8a' : isHover ? '#ffe27a' : '#5cf3ff';
    ctx.fillStyle = isSel
      ? 'rgba(255, 43, 138, 0.15)'
      : 'rgba(92, 243, 255, 0.08)';
    ctx.lineWidth = isSel ? 2 : 1.4;
    ctx.fillRect(a.x, a.y, w, h);
    ctx.strokeRect(a.x, a.y, w, h);
    // Resize handle (bottom-right)
    ctx.fillStyle = isSel ? '#ff2b8a' : '#5cf3ff';
    ctx.fillRect(b.x - 5, b.y - 5, 10, 10);
    // Index label
    ctx.fillStyle = isSel ? '#ff2b8a' : '#ffe27a';
    ctx.font = 'bold 11px monospace';
    ctx.fillText(`${i + 1}`, a.x + 4, a.y + 13);
  });
  // Draft rect (drawing in progress)
  if (logoCal.draftStart && logoCal.draftCurrent) {
    const a = logoCal.draftStart, b = logoCal.draftCurrent;
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    const w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
    ctx.strokeStyle = '#ffe27a';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
  }
  ctx.restore();
}

function updateLogoCalPanel() {
  if (logoCal.rects.length === 0) {
    logoCalValues.textContent = '(no slots yet — drag on the skyline to create one)';
    return;
  }
  let s = '';
  logoCal.rects.forEach((r, i) => {
    s += `{ id: 'slot-${i + 1}', xFrac: ${r.xFrac.toFixed(3)}, yFrac: ${r.yFrac.toFixed(3)}, wFrac: ${r.wFrac.toFixed(3)}, hFrac: ${r.hFrac.toFixed(3)}, content: '' },\n`;
  });
  logoCalValues.textContent = s;
}

function setLogoCalMode(on) {
  logoCal.on = on;
  logoCal.selected = -1;
  logoCal.drag = null;
  logoCal.draftStart = null;
  logoCal.draftCurrent = null;
  logoCalPanel.classList.toggle('hidden', !on);
  canvas.style.cursor = on ? 'crosshair' : 'none';
  if (on) {
    logoSnapCamera();
    updateLogoCalPanel();
  }
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'b' || e.key === 'B') {
    setLogoCalMode(!logoCal.on);
  } else if (logoCal.on) {
    if ((e.key === 'c' || e.key === 'C')) {
      let s = '';
      logoCal.rects.forEach((r, i) => {
        // Normalize xFrac into [0,1) — the skyline tiles, so cross-tile coords map to a single tile.
        let nx = r.xFrac % 1; if (nx < 0) nx += 1;
        s += `{ id: 'slot-${i + 1}', xFrac: ${nx.toFixed(3)}, yFrac: ${r.yFrac.toFixed(3)}, wFrac: ${r.wFrac.toFixed(3)}, hFrac: ${r.hFrac.toFixed(3)}, content: '' },\n`;
      });
      navigator.clipboard?.writeText(s);
      logoCalValues.textContent = '✓ Copied to clipboard!\n\n' + s;
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && logoCal.selected >= 0) {
      logoCal.rects.splice(logoCal.selected, 1);
      logoCal.selected = -1;
      updateLogoCalPanel();
    }
  }
});

canvas.addEventListener('mousedown', (e) => {
  if (!logoCal.on) return;
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const hit = hitTestRect(mx, my);
  if (hit.idx >= 0) {
    logoCal.selected = hit.idx;
    logoCal.drag = {
      idx: hit.idx,
      mode: hit.mode,
      startMx: mx, startMy: my,
      orig: { ...logoCal.rects[hit.idx] },
    };
    updateLogoCalPanel();
  } else {
    // Start a new draft rect
    logoCal.draftStart = { x: mx, y: my };
    logoCal.draftCurrent = { x: mx, y: my };
  }
});

canvas.addEventListener('mousemove', (e) => {
  if (!logoCal.on) return;
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  if (logoCal.drag) {
    const g = leftmostTileGeom();
    if (!g) return;
    const r = logoCal.rects[logoCal.drag.idx];
    const o = logoCal.drag.orig;
    const dx = (mx - logoCal.drag.startMx) / g.w;
    const dy = (my - logoCal.drag.startMy) / g.h;
    if (logoCal.drag.mode === 'move') {
      r.xFrac = o.xFrac + dx;
      r.yFrac = o.yFrac + dy;
    } else if (logoCal.drag.mode === 'resize-br') {
      r.wFrac = Math.max(0.005, o.wFrac + dx);
      r.hFrac = Math.max(0.005, o.hFrac + dy);
    }
    updateLogoCalPanel();
  } else if (logoCal.draftStart) {
    logoCal.draftCurrent = { x: mx, y: my };
  } else {
    const hit = hitTestRect(mx, my);
    logoCal.hover = hit.idx;
  }
});

window.addEventListener('mouseup', (e) => {
  if (!logoCal.on) return;
  if (logoCal.drag) {
    logoCal.drag = null;
    return;
  }
  if (logoCal.draftStart && logoCal.draftCurrent) {
    const a = logoCal.draftStart, b = logoCal.draftCurrent;
    const frac1 = screenToFrac(Math.min(a.x, b.x), Math.min(a.y, b.y));
    const frac2 = screenToFrac(Math.max(a.x, b.x), Math.max(a.y, b.y));
    if (frac1 && frac2) {
      const w = frac2.xFrac - frac1.xFrac;
      const h = frac2.yFrac - frac1.yFrac;
      if (w > 0.005 && h > 0.005) {
        logoCal.rects.push({
          xFrac: frac1.xFrac, yFrac: frac1.yFrac, wFrac: w, hFrac: h,
        });
        logoCal.selected = logoCal.rects.length - 1;
        updateLogoCalPanel();
      }
    }
    logoCal.draftStart = null;
    logoCal.draftCurrent = null;
  }
});

// ─────────────────────────────────────────────
// Entity display screens — HTML overlays attached to moving sprites
// (delivery bot, streetcar, drone). Each sprite has an optional `screen` rect
// in bounding-box-fraction coordinates; we project that to screen space each frame.
// ─────────────────────────────────────────────
const entityDisplaysRoot = document.getElementById('entity-displays');
const entityDisplayEls = new Map(); // asset name -> HTMLElement

function ensureEntityDisplayEl(sp) {
  if (entityDisplayEls.has(sp.asset)) return entityDisplayEls.get(sp.asset);
  const el = document.createElement('div');
  el.className = 'entity-display';
  el.dataset.asset = sp.asset;
  el.textContent = sp.screen?.content ?? '';
  entityDisplaysRoot.appendChild(el);
  entityDisplayEls.set(sp.asset, el);
  return el;
}

function spriteHeight(sp) {
  const img = assets[sp.asset];
  if (!img) return sp.width;
  return img.height * (sp.width / img.width);
}

function updateEntityDisplays() {
  for (const sp of sprites) {
    if (!sp.screen) continue;
    const img = assets[sp.asset];
    if (!img) continue;
    const el = ensureEntityDisplayEl(sp);
    const w = sp.width;
    const h = spriteHeight(sp);
    const screenX = sp.x + w * sp.screen.xFrac;
    const screenY = sp.yFrac * H + h * sp.screen.yFrac;
    const screenW = w * sp.screen.wFrac;
    const screenH = h * sp.screen.hFrac;
    el.style.transform = `translate(${screenX}px, ${screenY}px)`;
    el.style.width = `${screenW}px`;
    el.style.height = `${screenH}px`;
    el.style.fontSize = `${Math.max(8, Math.min(22, screenH * 0.5))}px`;
    el.textContent = sp.screen.content ?? '';
    // Hide while tracing entities (the trace overlay is the editing UI)
    el.style.display = entityCal.on ? 'none' : 'flex';
  }
}

// ─────────────────────────────────────────────
// Entity screen trace tool (press E to toggle)
// Snaps the entities to fixed screen positions, lets the user drag a
// rectangle inside each to define its screen area in bbox-fraction coords.
// ─────────────────────────────────────────────
const entityCal = {
  on: false,
  draftStart: null,
  draftCurrent: null,
  draftAsset: null,
  drag: null,        // { asset, mode: 'move'|'resize-br', startMx, startMy, orig }
  selectedAsset: null,
  savedX: new Map(), // asset name -> original x, restored on exit
};

const entityCalPanel = document.getElementById('entity-cal-panel');
const entityCalValues = document.getElementById('entity-cal-values');

function entitiesWithScreen() {
  return sprites.filter(s => s.screen);
}

function snapEntitiesForCalibration() {
  const list = entitiesWithScreen();
  list.forEach((sp, i) => {
    if (!entityCal.savedX.has(sp.asset)) entityCal.savedX.set(sp.asset, sp.x);
    sp.x = W * (i + 1) / (list.length + 1) - sp.width / 2;
  });
}

function restoreEntities() {
  for (const sp of entitiesWithScreen()) {
    const saved = entityCal.savedX.get(sp.asset);
    if (saved !== undefined) sp.x = saved;
  }
  entityCal.savedX.clear();
}

function entityBBoxScreen(sp) {
  const w = sp.width;
  const h = spriteHeight(sp);
  return { x: sp.x, y: sp.yFrac * H, w, h };
}

function screenRectScreen(sp) {
  if (!sp.screen) return null;
  const bb = entityBBoxScreen(sp);
  return {
    x: bb.x + bb.w * sp.screen.xFrac,
    y: bb.y + bb.h * sp.screen.yFrac,
    w: bb.w * sp.screen.wFrac,
    h: bb.h * sp.screen.hFrac,
  };
}

function findEntityAt(mx, my) {
  for (const sp of entitiesWithScreen()) {
    const bb = entityBBoxScreen(sp);
    if (mx >= bb.x && mx <= bb.x + bb.w && my >= bb.y && my <= bb.y + bb.h) return sp;
  }
  return null;
}

function entityHitTestRect(mx, my) {
  for (const sp of entitiesWithScreen()) {
    const r = screenRectScreen(sp);
    if (!r) continue;
    const distBR = Math.hypot(mx - (r.x + r.w), my - (r.y + r.h));
    if (distBR < 10) return { asset: sp.asset, mode: 'resize-br' };
    if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) {
      return { asset: sp.asset, mode: 'move' };
    }
  }
  return null;
}

function drawEntityTraceOverlay() {
  ctx.save();
  for (const sp of entitiesWithScreen()) {
    const bb = entityBBoxScreen(sp);
    const isSel = entityCal.selectedAsset === sp.asset;
    // Bounding box outline
    ctx.strokeStyle = isSel ? '#ffe27a' : 'rgba(255, 226, 122, 0.5)';
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 1;
    ctx.strokeRect(bb.x, bb.y, bb.w, bb.h);
    ctx.setLineDash([]);
    // Label
    ctx.fillStyle = '#ffe27a';
    ctx.font = 'bold 11px monospace';
    ctx.fillText(sp.asset, bb.x + 4, bb.y - 4);
    // Screen rect on top
    const r = screenRectScreen(sp);
    if (r) {
      ctx.strokeStyle = isSel ? '#ff2b8a' : '#5cf3ff';
      ctx.fillStyle = isSel
        ? 'rgba(255, 43, 138, 0.18)'
        : 'rgba(92, 243, 255, 0.10)';
      ctx.lineWidth = isSel ? 2 : 1.4;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = isSel ? '#ff2b8a' : '#5cf3ff';
      ctx.fillRect(r.x + r.w - 5, r.y + r.h - 5, 10, 10);
    }
  }
  // Draft rect (while drawing)
  if (entityCal.draftStart && entityCal.draftCurrent) {
    const a = entityCal.draftStart, b = entityCal.draftCurrent;
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    const w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
    ctx.strokeStyle = '#ffe27a';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
  }
  ctx.restore();
}

function entityCalValuesText() {
  let s = '';
  for (const sp of entitiesWithScreen()) {
    if (!sp.screen) continue;
    s += `// ${sp.asset}\n`;
    s += `screen: { xFrac: ${sp.screen.xFrac.toFixed(3)}, yFrac: ${sp.screen.yFrac.toFixed(3)}, wFrac: ${sp.screen.wFrac.toFixed(3)}, hFrac: ${sp.screen.hFrac.toFixed(3)}, content: '${sp.screen.content ?? ''}' },\n\n`;
  }
  return s;
}

function updateEntityCalPanel() {
  entityCalValues.textContent = entityCalValuesText();
}

function setEntityCalMode(on) {
  entityCal.on = on;
  entityCal.drag = null;
  entityCal.draftStart = null;
  entityCal.draftCurrent = null;
  entityCal.selectedAsset = null;
  entityCalPanel.classList.toggle('hidden', !on);
  canvas.style.cursor = on ? 'crosshair' : 'none';
  if (on) {
    snapEntitiesForCalibration();
    updateEntityCalPanel();
  } else {
    restoreEntities();
  }
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'e' || e.key === 'E') {
    if (logoCal.on) return; // mutually exclusive
    setEntityCalMode(!entityCal.on);
  } else if (entityCal.on && (e.key === 'c' || e.key === 'C')) {
    const s = entityCalValuesText();
    navigator.clipboard?.writeText(s);
    entityCalValues.textContent = '✓ Copied to clipboard!\n\n' + s;
  }
});

canvas.addEventListener('mousedown', (e) => {
  if (!entityCal.on) return;
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  // First check if click is on an existing screen rect (move/resize)
  const hit = entityHitTestRect(mx, my);
  if (hit) {
    const sp = sprites.find(s => s.asset === hit.asset);
    entityCal.selectedAsset = hit.asset;
    entityCal.drag = { asset: hit.asset, mode: hit.mode, startMx: mx, startMy: my, orig: { ...sp.screen } };
    updateEntityCalPanel();
    return;
  }
  // Otherwise start drawing a new rect — must start inside an entity bbox
  const sp = findEntityAt(mx, my);
  if (sp) {
    entityCal.selectedAsset = sp.asset;
    entityCal.draftAsset = sp.asset;
    entityCal.draftStart = { x: mx, y: my };
    entityCal.draftCurrent = { x: mx, y: my };
  }
});

canvas.addEventListener('mousemove', (e) => {
  if (!entityCal.on) return;
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  if (entityCal.drag) {
    const sp = sprites.find(s => s.asset === entityCal.drag.asset);
    const bb = entityBBoxScreen(sp);
    const o = entityCal.drag.orig;
    const dx = (mx - entityCal.drag.startMx) / bb.w;
    const dy = (my - entityCal.drag.startMy) / bb.h;
    if (entityCal.drag.mode === 'move') {
      sp.screen.xFrac = o.xFrac + dx;
      sp.screen.yFrac = o.yFrac + dy;
    } else if (entityCal.drag.mode === 'resize-br') {
      sp.screen.wFrac = Math.max(0.01, o.wFrac + dx);
      sp.screen.hFrac = Math.max(0.01, o.hFrac + dy);
    }
    updateEntityCalPanel();
  } else if (entityCal.draftStart) {
    entityCal.draftCurrent = { x: mx, y: my };
  }
});

window.addEventListener('mouseup', () => {
  if (!entityCal.on) return;
  if (entityCal.drag) { entityCal.drag = null; return; }
  if (entityCal.draftStart && entityCal.draftCurrent && entityCal.draftAsset) {
    const sp = sprites.find(s => s.asset === entityCal.draftAsset);
    if (sp) {
      const bb = entityBBoxScreen(sp);
      const a = entityCal.draftStart, b = entityCal.draftCurrent;
      const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
      const w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
      if (w > 4 && h > 4) {
        sp.screen = {
          xFrac: (x - bb.x) / bb.w,
          yFrac: (y - bb.y) / bb.h,
          wFrac: w / bb.w,
          hFrac: h / bb.h,
          content: sp.screen?.content ?? '',
        };
        updateEntityCalPanel();
      }
    }
    entityCal.draftStart = null;
    entityCal.draftCurrent = null;
    entityCal.draftAsset = null;
  }
});

// ─────────────────────────────────────────────
// Wheel calibration (press D to toggle)
// Works on any sprite that has a `wheels` array (cars + streetcar).
// Drag wheels to reposition · scroll on a selected wheel to resize · C to copy.
// ─────────────────────────────────────────────
const wheelCal = {
  on: false,
  selected: null,  // {spriteIdx, wheelIdx}
  dragging: null,
  hover: null,
  savedX: new Map(),
};
const wheelCalPanel = document.getElementById('wheel-cal-panel');
const wheelCalValues = document.getElementById('wheel-cal-values');

function wheeledSpriteIndices() {
  const out = [];
  for (let i = 0; i < sprites.length; i++) {
    if (sprites[i].wheels) out.push(i);
  }
  return out;
}

function wheelScreenPos(sp, wheel) {
  const w = sp.width;
  const h = spriteHeight(sp);
  return {
    cx: sp.x + w * wheel.xFrac,
    cy: sp.yFrac * H + h * wheel.yFrac,
    r:  w * wheel.rFrac,
  };
}

function wheelHitTest(mx, my) {
  for (const si of wheeledSpriteIndices()) {
    const sp = sprites[si];
    for (let wi = 0; wi < sp.wheels.length; wi++) {
      const { cx, cy, r } = wheelScreenPos(sp, sp.wheels[wi]);
      const dist = Math.hypot(mx - cx, my - cy);
      if (dist < Math.max(r + 6, 14)) return { spriteIdx: si, wheelIdx: wi };
    }
  }
  return null;
}

function snapWheeledForCalibration() {
  const idxs = wheeledSpriteIndices();
  for (let i = 0; i < idxs.length; i++) {
    const sp = sprites[idxs[i]];
    if (!wheelCal.savedX.has(idxs[i])) wheelCal.savedX.set(idxs[i], sp.x);
    sp.x = W * (i + 1) / (idxs.length + 1) - sp.width / 2;
  }
}

function restoreWheeled() {
  for (const [idx, x] of wheelCal.savedX) sprites[idx].x = x;
  wheelCal.savedX.clear();
}

function drawWheelCalOverlay() {
  ctx.save();
  for (const si of wheeledSpriteIndices()) {
    const sp = sprites[si];
    // Asset label above the sprite
    ctx.fillStyle = '#ffe27a';
    ctx.font = 'bold 11px monospace';
    ctx.fillText(sp.asset, sp.x + 4, sp.yFrac * H - 4);
    for (let wi = 0; wi < sp.wheels.length; wi++) {
      const { cx, cy, r } = wheelScreenPos(sp, sp.wheels[wi]);
      const isSel = wheelCal.selected && wheelCal.selected.spriteIdx === si && wheelCal.selected.wheelIdx === wi;
      const isHover = !isSel && wheelCal.hover && wheelCal.hover.spriteIdx === si && wheelCal.hover.wheelIdx === wi;
      const color = isSel ? '#ff2b8a' : isHover ? '#ffe27a' : '#5cf3ff';
      ctx.strokeStyle = color;
      ctx.lineWidth = isSel ? 2.5 : 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx - r - 6, cy); ctx.lineTo(cx + r + 6, cy);
      ctx.moveTo(cx, cy - r - 6); ctx.lineTo(cx, cy + r + 6);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function wheelCalValuesText() {
  let s = '';
  for (const si of wheeledSpriteIndices()) {
    const sp = sprites[si];
    s += `// ${sp.asset}\nwheels: [\n`;
    for (const w of sp.wheels) {
      s += `  { xFrac: ${w.xFrac.toFixed(3)}, yFrac: ${w.yFrac.toFixed(3)}, rFrac: ${w.rFrac.toFixed(3)} },\n`;
    }
    s += '],\n\n';
  }
  return s;
}

function updateWheelCalPanel() {
  wheelCalValues.textContent = wheelCalValuesText();
}

function setWheelCalMode(on) {
  wheelCal.on = on;
  wheelCal.selected = null;
  wheelCal.dragging = null;
  wheelCal.hover = null;
  wheelCalPanel.classList.toggle('hidden', !on);
  canvas.style.cursor = on ? 'crosshair' : 'none';
  if (on) {
    snapWheeledForCalibration();
    updateWheelCalPanel();
  } else {
    restoreWheeled();
  }
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'd' || e.key === 'D') {
    if (logoCal.on || entityCal.on) return; // mutually exclusive
    setWheelCalMode(!wheelCal.on);
  } else if (wheelCal.on && (e.key === 'c' || e.key === 'C')) {
    const s = wheelCalValuesText();
    navigator.clipboard?.writeText(s);
    wheelCalValues.textContent = '✓ Copied to clipboard!\n\n' + s;
  }
});

canvas.addEventListener('mousedown', (e) => {
  if (!wheelCal.on) return;
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const hit = wheelHitTest(mx, my);
  if (hit) {
    wheelCal.dragging = hit;
    wheelCal.selected = hit;
    updateWheelCalPanel();
  }
});

canvas.addEventListener('mousemove', (e) => {
  if (!wheelCal.on) return;
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  if (wheelCal.dragging) {
    const sp = sprites[wheelCal.dragging.spriteIdx];
    const wheel = sp.wheels[wheelCal.dragging.wheelIdx];
    wheel.xFrac = (mx - sp.x) / sp.width;
    wheel.yFrac = (my - sp.yFrac * H) / spriteHeight(sp);
    updateWheelCalPanel();
  } else {
    wheelCal.hover = wheelHitTest(mx, my);
  }
});

window.addEventListener('mouseup', () => { if (wheelCal.on) wheelCal.dragging = null; });

canvas.addEventListener('wheel', (e) => {
  if (!wheelCal.on || !wheelCal.selected) return;
  e.preventDefault();
  const sp = sprites[wheelCal.selected.spriteIdx];
  const wheel = sp.wheels[wheelCal.selected.wheelIdx];
  const step = e.deltaY < 0 ? 0.003 : -0.003;
  wheel.rFrac = Math.max(0.005, Math.min(0.30, wheel.rFrac + step));
  updateWheelCalPanel();
}, { passive: false });
