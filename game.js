(() => {
  'use strict';

  // ---------- Elemen DOM ----------
  const stage = document.getElementById('stage');
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const scoreEl = document.getElementById('score');
  const bestEl = document.getElementById('best');
  const startScreen = document.getElementById('startScreen');
  const overScreen = document.getElementById('overScreen');
  const finalScoreEl = document.getElementById('finalScore');
  const newBestEl = document.getElementById('newBest');
  const restartBtn = document.getElementById('restartBtn');

  // ---------- Konstanta ----------
  const WIDE_W = 600;          // lebar dunia minimum di layar lebar (unit game)
  const NARROW_W = 440;        // di layar sempit (HP tegak) dunia di-zoom agar karakter tidak terlalu kecil
  const BASE_H = 240;          // tinggi dunia minimum
  const GROUND_MARGIN = 34;    // jarak tanah dari bawah
  const GRAVITY = 2300;
  const JUMP_V = 740;
  const JUMP_CUT_V = 320;      // lepas tombol lebih cepat = lompat lebih rendah
  const START_SPEED = 330;
  const ACCEL = 11;            // pertambahan kecepatan per detik
  const MAX_SPEED = 820;
  const JUMP_BUFFER = 0.13;    // detik
  const PLAYER_X = 70;
  const BODY_R = 12;
  const LEG = 8;
  const INK = '#111';
  const PAPER = '#fff';
  const BEST_KEY = 'lari-bulat-best';

  // ---------- Status ----------
  let baseW = WIDE_W;
  let speedMul = 1;            // kecepatan disesuaikan dengan lebar dunia
  let viewW = WIDE_W, viewH = BASE_H, groundY = BASE_H - GROUND_MARGIN, dpr = 1, scale = 1;
  let state = 'ready';          // ready | running | paused | over
  let speed = START_SPEED;
  let distance = 0;
  let score = 0;
  let best = loadBest();
  let obstacles = [];
  let nextGap = 0;
  let specks = [];              // titik-titik tanah
  let marks = [];               // tanda di langit (parallax)
  let overAt = 0;
  let flashUntil = 0;
  let lastMilestone = 0;
  let time = 0;

  const player = {
    h: 0,            // ketinggian di atas tanah
    vy: 0,
    onGround: true,
    holding: false,
    buffer: 0,
    phase: 0,        // fase animasi kaki
    blink: 0,
    dead: false,
  };

  // ---------- Penyimpanan skor tertinggi ----------
  function loadBest() {
    try {
      return parseInt(localStorage.getItem(BEST_KEY), 10) || 0;
    } catch (e) {
      return 0;
    }
  }

  function saveBest(v) {
    try {
      localStorage.setItem(BEST_KEY, String(v));
    } catch (e) { /* abaikan (mis. mode privat) */ }
  }

  const pad = (n) => String(Math.floor(n)).padStart(5, '0');

  // ---------- Ukuran layar ----------
  function resize() {
    const rect = stage.getBoundingClientRect();
    const cw = Math.max(1, rect.width);
    const ch = Math.max(1, rect.height);
    dpr = Math.min(window.devicePixelRatio || 1, 3);
    baseW = cw / ch < 1.6 ? NARROW_W : WIDE_W;
    const newMul = baseW / WIDE_W;
    speed *= newMul / speedMul;   // mis. HP diputar saat bermain
    speedMul = newMul;
    scale = Math.min(cw / baseW, ch / BASE_H);
    viewW = cw / scale;
    viewH = ch / scale;
    groundY = viewH - GROUND_MARGIN;
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    initScenery();
    draw();
  }

  function initScenery() {
    specks = [];
    for (let x = 0; x < viewW + 40; x += 18 + Math.random() * 30) {
      specks.push(makeSpeck(x));
    }
    marks = [];
    for (let x = 0; x < viewW + 60; x += 70 + Math.random() * 110) {
      marks.push(makeMark(x));
    }
  }

  function makeSpeck(x) {
    return { x, dy: 5 + Math.random() * 18, w: 2 + Math.random() * 7 };
  }

  function makeMark(x) {
    const top = 18;
    const bottom = Math.max(top + 10, groundY - 90);
    return { x, y: top + Math.random() * (bottom - top), s: 2 + Math.random() * 3 };
  }

  // ---------- Rintangan (bentuk sendiri) ----------
  // tipe: 'tiang' (batang + bola di atas), 'gerigi' (deretan segitiga), 'kotak' (tumpukan kotak)
  function makeObstacle() {
    const level = Math.min(1, (speed - START_SPEED * speedMul) / ((MAX_SPEED - START_SPEED) * speedMul));
    const r = Math.random();
    let o;
    if (r < 0.34) {
      const h = 30 + Math.random() * (14 + level * 10);
      o = { type: 'tiang', w: 12, h };
    } else if (r < 0.67) {
      const n = 2 + Math.floor(Math.random() * (2 + (level > 0.4 ? 1 : 0)));
      o = { type: 'gerigi', w: n * 13, h: 18, n };
    } else {
      const cols = 1 + (Math.random() < 0.35 + level * 0.3 ? 1 : 0);
      const rows = 1 + (Math.random() < 0.45 ? 1 : 0);
      o = { type: 'kotak', w: cols * 20, h: rows * 20, cols, rows };
    }
    o.x = viewW + 10;
    return o;
  }

  function scheduleGap() {
    // Jarak minimal selalu cukup untuk mendarat dan melompat lagi
    const airTime = (2 * JUMP_V) / GRAVITY;
    const minGap = speed * airTime * 1.05 + 60;
    nextGap = minGap + Math.random() * speed * 0.75;
  }

  // ---------- Kontrol ----------
  function press() {
    if (state === 'ready') {
      start();
      jump();
      return;
    }
    if (state === 'paused') {
      state = 'running';
      return;
    }
    if (state === 'over') {
      if (performance.now() - overAt > 450) restart();
      return;
    }
    player.holding = true;
    if (player.onGround) jump();
    else player.buffer = JUMP_BUFFER;
  }

  function release() {
    player.holding = false;
    if (!player.onGround && player.vy > JUMP_CUT_V) player.vy = JUMP_CUT_V;
  }

  function jump() {
    player.vy = JUMP_V;
    player.onGround = false;
    player.holding = true;
    player.buffer = 0;
  }

  const JUMP_KEYS = ['Space', 'ArrowUp', 'KeyW'];

  window.addEventListener('keydown', (e) => {
    if (JUMP_KEYS.includes(e.code)) {
      e.preventDefault();
      if (e.repeat) return;
      press();
    } else if (e.code === 'Enter' && state === 'over') {
      e.preventDefault();
      if (performance.now() - overAt > 450) restart();
    } else if (e.code === 'KeyP' || e.code === 'Escape') {
      togglePause();
    }
  });

  window.addEventListener('keyup', (e) => {
    if (JUMP_KEYS.includes(e.code)) release();
  });

  document.addEventListener('pointerdown', (e) => {
    if (e.target.closest && e.target.closest('button')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    press();
  });
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);
  document.addEventListener('contextmenu', (e) => e.preventDefault());

  restartBtn.addEventListener('click', () => restart());

  function togglePause() {
    if (state === 'running') {
      state = 'paused';
      draw();
    } else if (state === 'paused') {
      state = 'running';
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state === 'running') {
      state = 'paused';
      draw();
    }
  });

  // ---------- Siklus permainan ----------
  function reset() {
    speed = START_SPEED * speedMul;
    distance = 0;
    score = 0;
    lastMilestone = 0;
    flashUntil = 0;
    obstacles = [];
    Object.assign(player, { h: 0, vy: 0, onGround: true, holding: false, buffer: 0, phase: 0, dead: false });
    scheduleGap();
    nextGap = viewW * 0.55; // rintangan pertama datang agak jauh
    scoreEl.textContent = pad(0);
  }

  function start() {
    reset();
    state = 'running';
    startScreen.classList.add('hidden');
    overScreen.classList.add('hidden');
  }

  function restart() {
    if (state !== 'over') return;
    restartBtn.blur();
    start();
  }

  function gameOver() {
    state = 'over';
    player.dead = true;
    scoreEl.style.visibility = 'visible';
    overAt = performance.now();
    const final = Math.floor(score);
    finalScoreEl.textContent = final;
    const isBest = final > best;
    if (isBest) {
      best = final;
      saveBest(best);
      bestEl.textContent = pad(best);
    }
    newBestEl.classList.toggle('hidden', !isBest);
    draw();
    setTimeout(() => {
      if (state !== 'over') return;
      overScreen.classList.remove('hidden');
      // Fokus ke tombol hanya di perangkat dengan keyboard
      if (window.matchMedia('(hover: hover)').matches) restartBtn.focus({ preventScroll: true });
    }, 350);
  }

  function update(dt) {
    time += dt;

    // Kedip mata sesekali
    player.blink -= dt;
    if (player.blink < -3 - Math.random() * 3) player.blink = 0.12;

    if (state === 'ready') {
      player.phase += dt * 4;
      return;
    }
    if (state !== 'running') return;

    speed = Math.min(MAX_SPEED * speedMul, speed + ACCEL * speedMul * dt);
    const dx = speed * dt;
    distance += dx;
    score = (distance / speedMul) * 0.025;

    const s = Math.floor(score);
    scoreEl.textContent = pad(s);
    const milestone = Math.floor(s / 100);
    if (milestone > lastMilestone) {
      lastMilestone = milestone;
      flashUntil = time + 0.9;
    }
    scoreEl.style.visibility = time < flashUntil && Math.floor(time * 8) % 2 ? 'hidden' : 'visible';

    // Pemain
    if (!player.onGround) {
      player.vy -= GRAVITY * dt;
      player.h += player.vy * dt;
      if (player.buffer > 0) player.buffer -= dt;
      if (player.h <= 0) {
        player.h = 0;
        player.vy = 0;
        player.onGround = true;
        if (player.buffer > 0) jump();
      }
    } else {
      player.phase += dt * speed * 0.045;
    }

    // Rintangan
    for (const o of obstacles) o.x -= dx;
    obstacles = obstacles.filter((o) => o.x + o.w > -20);
    nextGap -= dx;
    if (nextGap <= 0) {
      obstacles.push(makeObstacle());
      scheduleGap();
    }

    // Pemandangan
    for (const sp of specks) {
      sp.x -= dx;
      if (sp.x < -10) Object.assign(sp, makeSpeck(viewW + Math.random() * 30));
    }
    for (const m of marks) {
      m.x -= dx * 0.15;
      if (m.x < -10) Object.assign(m, makeMark(viewW + Math.random() * 80));
    }

    // Tabrakan (hitbox sedikit lebih kecil agar terasa adil)
    const pl = PLAYER_X - BODY_R + 3;
    const pr = PLAYER_X + BODY_R - 3;
    const pb = player.h + 2;
    const pt = player.h + LEG + BODY_R * 2 - 3;
    for (const o of obstacles) {
      let ol = o.x + 2, or = o.x + o.w - 2, ot = o.h - 2;
      if (o.type === 'gerigi') { ol += 3; or -= 3; ot = o.h * 0.7; }
      if (o.type === 'tiang') { ol = o.x + 1; or = o.x + o.w - 1; }
      if (pr > ol && pl < or && pb < ot && pt > 0) {
        gameOver();
        return;
      }
    }
  }

  // ---------- Gambar ----------
  function draw() {
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, viewW, viewH);

    // Tanda langit: tanda tambah kecil
    ctx.strokeStyle = '#bbb';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (const m of marks) {
      ctx.moveTo(m.x - m.s, m.y);
      ctx.lineTo(m.x + m.s, m.y);
      ctx.moveTo(m.x, m.y - m.s);
      ctx.lineTo(m.x, m.y + m.s);
    }
    ctx.stroke();

    // Tanah
    ctx.fillStyle = INK;
    ctx.fillRect(0, groundY, viewW, 2);
    for (const sp of specks) {
      ctx.fillRect(sp.x, groundY + sp.dy, sp.w, 1.5);
    }

    for (const o of obstacles) drawObstacle(o);
    drawPlayer();

    if (state === 'paused') {
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.fillRect(0, 0, viewW, viewH);
      ctx.fillStyle = INK;
      ctx.font = 'bold 22px ui-monospace, Menlo, monospace';
      ctx.textAlign = 'center';
      ctx.fillText('JEDA', viewW / 2, viewH / 2 - 4);
      ctx.font = '12px ui-monospace, Menlo, monospace';
      ctx.fillText('ketuk / Spasi / P untuk lanjut', viewW / 2, viewH / 2 + 18);
    }
  }

  function drawObstacle(o) {
    const base = groundY;
    ctx.fillStyle = INK;
    ctx.strokeStyle = INK;

    if (o.type === 'tiang') {
      // batang dengan cincin di puncak
      const cx = o.x + o.w / 2;
      ctx.fillRect(cx - 3, base - o.h + 8, 6, o.h - 8);
      ctx.fillRect(o.x, base - 4, o.w, 4);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, base - o.h + 6, 5, 0, Math.PI * 2);
      ctx.stroke();
    } else if (o.type === 'gerigi') {
      const w = o.w / o.n;
      ctx.beginPath();
      for (let i = 0; i < o.n; i++) {
        const x = o.x + i * w;
        ctx.moveTo(x, base);
        ctx.lineTo(x + w / 2, base - o.h);
        ctx.lineTo(x + w, base);
      }
      ctx.closePath();
      ctx.fill();
    } else {
      // tumpukan kotak bergaris diagonal
      for (let c = 0; c < o.cols; c++) {
        for (let r = 0; r < o.rows; r++) {
          const x = o.x + c * 20;
          const y = base - (r + 1) * 20;
          ctx.fillStyle = INK;
          ctx.fillRect(x, y, 20, 20);
          ctx.fillStyle = PAPER;
          ctx.fillRect(x + 3, y + 3, 14, 14);
          ctx.strokeStyle = INK;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(x + 3, y + 17);
          ctx.lineTo(x + 17, y + 3);
          ctx.stroke();
        }
      }
    }
  }

  function drawPlayer() {
    const x = PLAYER_X;
    const feet = groundY - player.h;
    const cy = feet - LEG - BODY_R;

    ctx.strokeStyle = INK;
    ctx.fillStyle = INK;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';

    // Kaki
    ctx.beginPath();
    if (player.onGround && !player.dead) {
      const a = Math.sin(player.phase) * 5;
      ctx.moveTo(x - 3, cy + BODY_R - 2);
      ctx.lineTo(x - 3 + a, feet);
      ctx.moveTo(x + 3, cy + BODY_R - 2);
      ctx.lineTo(x + 3 - a, feet);
    } else {
      // kaki terlipat saat di udara
      ctx.moveTo(x - 4, cy + BODY_R - 2);
      ctx.lineTo(x - 7, feet - 3);
      ctx.moveTo(x + 4, cy + BODY_R - 2);
      ctx.lineTo(x + 7, feet - 3);
    }
    ctx.stroke();

    // Badan bulat (sedikit memantul saat berlari)
    const bob = player.onGround && !player.dead ? Math.abs(Math.sin(player.phase)) * 1.5 : 0;
    const by = cy - bob;
    ctx.beginPath();
    ctx.arc(x, by, BODY_R, 0, Math.PI * 2);
    ctx.fill();

    // Antena kecil yang terayun
    const sway = player.onGround ? Math.sin(player.phase * 0.5) * 2 : -3;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - 2, by - BODY_R + 1);
    ctx.quadraticCurveTo(x - 4 + sway, by - BODY_R - 6, x - 7 + sway, by - BODY_R - 8);
    ctx.stroke();

    // Mata
    const ex = x + 5;
    const ey = by - 3;
    if (player.dead) {
      ctx.strokeStyle = PAPER;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(ex - 3, ey - 3);
      ctx.lineTo(ex + 3, ey + 3);
      ctx.moveTo(ex + 3, ey - 3);
      ctx.lineTo(ex - 3, ey + 3);
      ctx.stroke();
    } else if (player.blink > 0) {
      ctx.fillStyle = PAPER;
      ctx.fillRect(ex - 3.5, ey - 0.75, 7, 1.5);
    } else {
      ctx.fillStyle = PAPER;
      ctx.beginPath();
      ctx.arc(ex, ey, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.arc(ex + 1.5, ey + (player.onGround ? 0 : -1), 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.lineCap = 'butt';
  }

  // ---------- Loop ----------
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    update(dt);
    if (state !== 'over' && state !== 'paused') draw();
    requestAnimationFrame(frame);
  }

  // ---------- Mulai ----------
  bestEl.textContent = pad(best);
  scoreEl.textContent = pad(0);
  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(stage);
  window.addEventListener('resize', resize);
  resize();
  reset();
  requestAnimationFrame(frame);
})();
