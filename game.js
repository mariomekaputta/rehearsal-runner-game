(() => {
  "use strict";

  // ---- Konstanta dunia (dalam "unit", tinggi dunia selalu 200 unit) ----
  const WORLD_H = 200;
  const GROUND_Y = 170;
  const GRAVITY = 1900;
  const JUMP_V = 600;
  const DOUBLE_JUMP_V = 420; // lompatan kedua sedikit lebih lemah agar tidak keluar layar
  const START_SPEED = 280;
  const MAX_SPEED = 680;
  const ACCEL = 7; // unit/detik per detik
  const PLAYER_X = 46;
  const PLAYER_W = 20;
  const PLAYER_H = 24;
  const JUMP_BUFFER = 0.12; // detik, lompatan yang ditekan sesaat sebelum mendarat tetap terhitung
  const RESTART_LOCK = 0.5; // detik, cegah langsung main lagi tak sengaja
  const BEST_KEY = "lariTerus.best";
  // Rintangan tinggi: lebih tinggi dari puncak lompatan biasa (~95 unit), jadi wajib lompat 2x
  const TALL_MIN_SCORE = 300;
  const TALL_CHANCE = 0.25;
  const TALL_HINT_TIME = 2.2; // detik waktu permainan

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const stage = document.getElementById("stage");
  const scoreEl = document.getElementById("score");
  const bestEl = document.getElementById("best");
  const startScreen = document.getElementById("startScreen");
  const overScreen = document.getElementById("overScreen");
  const finalScoreEl = document.getElementById("finalScore");
  const newBestEl = document.getElementById("newBest");
  const restartBtn = document.getElementById("restartBtn");
  const pauseScreen = document.getElementById("pauseScreen");
  const pauseBtn = document.getElementById("pauseBtn");
  const tallHint = document.getElementById("tallHint");

  let scale = 1;
  let viewW = 600; // lebar dunia yang terlihat (unit)

  let state = "ready"; // ready | playing | paused | over
  let player, obstacles, speed, distance, nextGap, groundOffset, runTime, jumpBuffer, overTime;
  let tallSeen, hintTimer;
  let best = loadBest();

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
    } catch (e) {
      /* abaikan (mis. mode privat) */
    }
  }

  const pad = (n) => String(n).padStart(5, "0");

  // ---- Ukuran kanvas responsif ----
  function resize() {
    const cssW = stage.clientWidth;
    const portrait = window.innerHeight > window.innerWidth;
    const cssH = Math.round(
      Math.min(cssW * (portrait ? 0.5 : 0.4), 340, window.innerHeight * 0.7)
    );
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.style.height = cssH + "px";
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    scale = cssH / WORLD_H;
    viewW = cssW / scale;
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
    draw();
  }

  // ---- Reset / mulai ----
  function reset() {
    player = { y: GROUND_Y - PLAYER_H, vy: 0, onGround: true, canDouble: false };
    obstacles = [];
    speed = START_SPEED;
    distance = 0;
    groundOffset = 0;
    runTime = 0;
    jumpBuffer = 0;
    nextGap = viewW * 0.6;
    tallSeen = false;
    hintTimer = 0;
    tallHint.classList.add("hidden");
    updateScore();
  }

  function start() {
    reset();
    state = "playing";
    startScreen.classList.add("hidden");
    overScreen.classList.add("hidden");
    pauseScreen.classList.add("hidden");
    pauseBtn.classList.remove("hidden", "paused");
  }

  // Jeda: update() tidak dipanggil sama sekali, jadi dunia dan skor berhenti total
  function togglePause() {
    if (state === "playing") {
      state = "paused";
      pauseScreen.classList.remove("hidden");
      pauseBtn.classList.add("paused");
      pauseBtn.setAttribute("aria-label", "Lanjut");
    } else if (state === "paused") {
      state = "playing";
      pauseScreen.classList.add("hidden");
      pauseBtn.classList.remove("paused");
      pauseBtn.setAttribute("aria-label", "Jeda");
    }
  }

  function gameOver() {
    state = "over";
    overTime = performance.now();
    const score = currentScore();
    const isNew = score > best;
    if (isNew) {
      best = score;
      saveBest(best);
    }
    bestEl.textContent = pad(best);
    finalScoreEl.textContent = score;
    newBestEl.hidden = !isNew;
    overScreen.classList.remove("hidden");
    pauseBtn.classList.add("hidden");
    tallHint.classList.add("hidden");
  }

  function currentScore() {
    return Math.floor(distance / 10);
  }

  function updateScore() {
    scoreEl.textContent = pad(currentScore());
    bestEl.textContent = pad(best);
  }

  // ---- Input ----
  function press() {
    if (state === "ready") {
      start();
      doJump();
    } else if (state === "playing") {
      if (player.onGround) {
        doJump();
      } else {
        // Hampir mendarat: simpan sebagai lompatan berikutnya, jangan habiskan lompatan kedua
        const toGround = GROUND_Y - PLAYER_H - player.y;
        const landingSoon = player.vy > 0 && toGround < player.vy * JUMP_BUFFER;
        if (!landingSoon && player.canDouble) doDoubleJump();
        else jumpBuffer = JUMP_BUFFER;
      }
    }
  }

  function doJump() {
    player.vy = -JUMP_V;
    player.onGround = false;
    player.canDouble = true;
    jumpBuffer = 0;
  }

  function doDoubleJump() {
    player.vy = -DOUBLE_JUMP_V;
    player.canDouble = false;
    jumpBuffer = 0;
  }

  function tryRestart() {
    if (state === "over" && performance.now() - overTime > RESTART_LOCK * 1000) start();
  }

  window.addEventListener("keydown", (e) => {
    if (e.code === "KeyP" || e.key === "p" || e.key === "P") {
      if (!e.repeat) togglePause();
      return;
    }
    if (state === "paused") return;
    if (e.code === "Space" || e.key === " ") {
      e.preventDefault();
      if (e.repeat) return;
      if (state === "over") tryRestart();
      else press();
    }
  });

  stage.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button")) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    if (state === "ready" || state === "playing") press();
  });

  restartBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    restartBtn.blur();
    tryRestart();
  });

  pauseBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    pauseBtn.blur();
    togglePause();
  });

  // Cegah menu konteks / zoom karena tekan lama atau gestur di area game
  stage.addEventListener("contextmenu", (e) => e.preventDefault());
  document.addEventListener("gesturestart", (e) => e.preventDefault());

  // ---- Rintangan ----
  // Tiga bentuk sederhana: kotak, tiang dengan topi, dan deretan duri.
  function spawnObstacle() {
    const r = Math.random();
    let o;
    if (currentScore() >= TALL_MIN_SCORE && (!tallSeen || Math.random() < TALL_CHANCE)) {
      // Menara tinggi: muncul pasti sekali segera setelah skor 300, lalu acak
      o = { type: "tall", w: 16, h: 102 + Math.random() * 6 };
      if (!tallSeen) {
        tallSeen = true;
        hintTimer = TALL_HINT_TIME;
        tallHint.classList.remove("hidden");
      }
    } else if (r < 0.4) {
      const w = 16 + Math.random() * 14;
      const h = 18 + Math.random() * 14;
      o = { type: "box", w, h };
    } else if (r < 0.7) {
      o = { type: "pole", w: 12, h: 34 + Math.random() * 12 };
    } else {
      const n = 2 + Math.floor(Math.random() * (speed > 450 ? 3 : 2));
      o = { type: "spikes", w: n * 11, h: 16, n };
    }
    o.x = viewW + 10;
    obstacles.push(o);
    return o;
  }

  function hitbox(o) {
    // Sedikit dikecilkan agar terasa adil
    if (o.type === "spikes") return { x: o.x + 3, y: GROUND_Y - o.h + 5, w: o.w - 6, h: o.h - 5 };
    return { x: o.x + 2, y: GROUND_Y - o.h + 2, w: o.w - 4, h: o.h - 2 };
  }

  function collides(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  // ---- Update ----
  function update(dt) {
    runTime += dt;
    speed = Math.min(MAX_SPEED, START_SPEED + ACCEL * runTime);
    const dx = speed * dt;
    distance += dx;
    groundOffset = (groundOffset + dx) % 40;

    // Fisika pemain
    if (jumpBuffer > 0) jumpBuffer -= dt;
    if (!player.onGround) {
      player.vy += GRAVITY * dt;
      player.y += player.vy * dt;
      if (player.y >= GROUND_Y - PLAYER_H) {
        player.y = GROUND_Y - PLAYER_H;
        player.vy = 0;
        player.onGround = true;
        player.canDouble = false;
        if (jumpBuffer > 0) doJump();
      }
    }

    // Rintangan
    for (const o of obstacles) o.x -= dx;
    obstacles = obstacles.filter((o) => o.x + o.w > -20);

    nextGap -= dx;
    if (nextGap <= 0) {
      const o = spawnObstacle();
      // Jarak antar rintangan ikut membesar sesuai kecepatan agar selalu bisa dilompati.
      // Setelah rintangan tinggi, beri ruang untuk lompatan ganda yang lebih lama di udara.
      const airTime = o.type === "tall" ? 1.0 : (2 * JUMP_V) / GRAVITY;
      nextGap = speed * airTime + 70 + Math.random() * (speed * 0.9);
    }

    if (hintTimer > 0) {
      hintTimer -= dt;
      if (hintTimer <= 0) tallHint.classList.add("hidden");
    }

    // Tabrakan
    const pb = { x: PLAYER_X + 3, y: player.y + 3, w: PLAYER_W - 6, h: PLAYER_H - 4 };
    for (const o of obstacles) {
      if (collides(pb, hitbox(o))) {
        gameOver();
        break;
      }
    }

    updateScore();
  }

  // ---- Gambar ----
  const COLORS = {
    skyTop: "#7ec8ff",
    skyBottom: "#d6f0ff",
    cloud: "rgba(255, 255, 255, 0.9)",
    grass: "#5ccf6b",
    grassDark: "#3fae52",
    soil: "#e8b56a",
    soilDots: "#c98f45",
    player: "#ff7a45",
    playerLeg: "#c4512a",
    box: "#8e6cf0",
    boxLine: "#b9a3ff",
    pole: "#2fb3a6",
    poleCap: "#ffcf3a",
    spikes: "#ff4f7a",
    tall: "#3a6df0",
    tallStripe: "#9db8ff",
  };

  // Awan bergerak pelan (paralaks), hanya hiasan
  const clouds = [
    { x: 60, y: 30, s: 1 },
    { x: 260, y: 55, s: 0.7 },
    { x: 470, y: 25, s: 0.9 },
    { x: 700, y: 50, s: 0.8 },
  ];

  function draw() {
    const sky = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
    sky.addColorStop(0, COLORS.skyTop);
    sky.addColorStop(1, COLORS.skyBottom);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, viewW, GROUND_Y);

    // Awan
    const span = Math.max(viewW + 120, 900);
    ctx.fillStyle = COLORS.cloud;
    for (const c of clouds) {
      const cx = ((((c.x - distance * 0.15 * c.s) % span) + span) % span) - 60;
      drawCloud(cx, c.y, c.s);
    }

    // Tanah: rumput di atas, tanah cokelat muda di bawah
    ctx.fillStyle = COLORS.soil;
    ctx.fillRect(0, GROUND_Y, viewW, WORLD_H - GROUND_Y);
    ctx.fillStyle = COLORS.grass;
    ctx.fillRect(0, GROUND_Y, viewW, 5);
    ctx.fillStyle = COLORS.grassDark;
    ctx.fillRect(0, GROUND_Y + 5, viewW, 1.5);
    const off = player ? groundOffset : 0;
    ctx.fillStyle = COLORS.soilDots;
    for (let x = -off; x < viewW; x += 40) {
      ctx.fillRect(x + 6, GROUND_Y + 12, 6, 2);
      ctx.fillRect(x + 24, GROUND_Y + 21, 3, 2);
    }

    if (!player) return;
    for (const o of obstacles) drawObstacle(o);
    drawPlayer();
  }

  function drawCloud(x, y, s) {
    ctx.beginPath();
    ctx.arc(x, y, 9 * s, 0, Math.PI * 2);
    ctx.arc(x + 11 * s, y - 5 * s, 11 * s, 0, Math.PI * 2);
    ctx.arc(x + 24 * s, y, 9 * s, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawObstacle(o) {
    const top = GROUND_Y - o.h;
    if (o.type === "tall") {
      ctx.fillStyle = COLORS.tall;
      ctx.fillRect(o.x, top + 4, o.w, o.h - 4);
      ctx.fillRect(o.x + 2, top, o.w - 4, 4);
      ctx.fillStyle = COLORS.tallStripe;
      for (let sy = top + 12; sy < GROUND_Y - 6; sy += 14) {
        ctx.fillRect(o.x + 3, sy, o.w - 6, 2);
      }
    } else if (o.type === "box") {
      ctx.fillStyle = COLORS.box;
      ctx.fillRect(o.x, top, o.w, o.h);
      ctx.fillStyle = COLORS.boxLine;
      ctx.fillRect(o.x + 3, top + 3, o.w - 6, 1.5);
    } else if (o.type === "pole") {
      ctx.fillStyle = COLORS.pole;
      ctx.fillRect(o.x + 3, top + 6, o.w - 6, o.h - 6);
      ctx.fillStyle = COLORS.poleCap;
      ctx.beginPath();
      ctx.arc(o.x + o.w / 2, top + 6, o.w / 2, Math.PI, 0);
      ctx.fill();
    } else {
      const sw = o.w / o.n;
      ctx.fillStyle = COLORS.spikes;
      ctx.beginPath();
      for (let i = 0; i < o.n; i++) {
        const sx = o.x + i * sw;
        ctx.moveTo(sx, GROUND_Y);
        ctx.lineTo(sx + sw / 2, top);
        ctx.lineTo(sx + sw, GROUND_Y);
      }
      ctx.closePath();
      ctx.fill();
    }
  }

  // Karakter: badan bulat seperti tetesan dengan satu mata dan kaki bergantian
  function drawPlayer() {
    const x = PLAYER_X;
    const y = player.y;
    const w = PLAYER_W;
    const bodyH = PLAYER_H - 6;

    // Kaki
    ctx.strokeStyle = COLORS.playerLeg;
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.beginPath();
    if (player.onGround && state !== "ready") {
      const phase = Math.floor(distance / 14) % 2;
      const a = phase ? 4 : -2;
      ctx.moveTo(x + 7, y + bodyH);
      ctx.lineTo(x + 7 + a, y + PLAYER_H - 1);
      ctx.moveTo(x + 13, y + bodyH);
      ctx.lineTo(x + 13 - a, y + PLAYER_H - 1);
    } else {
      ctx.moveTo(x + 7, y + bodyH);
      ctx.lineTo(x + 4, y + PLAYER_H - 2);
      ctx.moveTo(x + 13, y + bodyH);
      ctx.lineTo(x + 17, y + PLAYER_H - 3);
    }
    ctx.stroke();

    // Badan
    ctx.fillStyle = COLORS.player;
    ctx.beginPath();
    roundRect(x, y, w, bodyH, 8);
    ctx.fill();

    // Mata
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(x + 14, y + 7, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#222";
    ctx.beginPath();
    ctx.arc(x + 15, y + 7, 1.3, 0, Math.PI * 2);
    ctx.fill();
  }

  function roundRect(x, y, w, h, r) {
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r / 3);
    ctx.arcTo(x, y + h, x, y, r / 3);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ---- Loop ----
  let last = performance.now();
  function loop(now) {
    const dt = Math.min((now - last) / 1000, 1 / 30);
    last = now;
    if (state === "playing") update(dt);
    draw();
    requestAnimationFrame(loop);
  }

  window.addEventListener("resize", resize);
  reset();
  resize();
  requestAnimationFrame(loop);
})();
