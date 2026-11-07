(() => {
  "use strict";

  const $ = id => document.querySelector(id);
  const canvas = $("#gameCanvas");
  const ctx = canvas.getContext("2d", { alpha: false });
  const W = canvas.width;
  const H = canvas.height;
  const horizon = 0.39;
  const keys = new Set();
  const settings = { vehicle: "car", mode: "race", theme: "day", difficulty: "normal", laps: 3 };
  const ui = {
    welcome: $("#welcomeScreen"), shell: $("#gameShell"), setup: $("#setupPanel"),
    hud: $("#hud"), lap: $("#lapValue"), pos: $("#positionValue"), time: $("#timeValue"),
    boost: $("#boostBar"), count: $("#countdown"), message: $("#message"),
    pause: $("#pauseBtn"), sound: $("#soundBtn"), status: $("#statusText")
  };
  const themes = {
    day: { sky: "#75c7ed", haze: "#eaf8ff", grass: "#3d8d4c", grass2: "#32713e", road: "#34383f", road2: "#3e434b", line: "#f8fbff", edge: "#e6c86b", object: "#27713b" },
    night: { sky: "#09132b", haze: "#263c68", grass: "#152b35", grass2: "#10232b", road: "#202832", road2: "#2b343f", line: "#d9f6ff", edge: "#6dd7e0", object: "#24466c" },
    desert: { sky: "#e89661", haze: "#ffd29a", grass: "#b8753c", grass2: "#9b5b32", road: "#4b4140", road2: "#5b4b47", line: "#fff2c6", edge: "#efd078", object: "#9b632f" }
  };
  const difficulty = { easy: 0.82, normal: 1, hard: 1.18 };
  let running = false, paused = false, muted = false, elapsed = 0, distance = 0;
  let playerX = 0, speed = 0, boost = 100, last = 0, raf = 0, countdownTimer = 0, collisionFlash = 0, hitCooldown = 0;
  let traffic = [], roadside = [], cones = [];

  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const fmt = ms => {
    const seconds = ms / 1000;
    return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${(seconds % 60).toFixed(1).padStart(4, "0")}`;
  };
  const project = (z, x = 0) => {
    const depth = 1 - z;
    const scale = 1 / (1 + z * 5.2);
    const roadHalf = 42 + depth * 510;
    return { x: W / 2 + x * roadHalf, y: H * horizon + depth * (H * (1 - horizon) + 35), scale, roadHalf };
  };
  const roadCenter = z => W / 2 + Math.sin(distance * 0.00055 + z * 8) * (1 - z) * 55;
  const curveOffset = z => roadCenter(z) - W / 2;

  function reset() {
    elapsed = 0; distance = 0; speed = 0; boost = 100; playerX = 0; paused = false; collisionFlash = 0; hitCooldown = 0;
    traffic = Array.from({ length: 7 }, (_, i) => ({
      z: 0.12 + i * 0.115, lane: (i % 3) - 1, color: ["#e84b55", "#ffd451", "#51b9e8", "#a871df"][i % 4],
      wobble: Math.random() * 6, speed: (0.32 + Math.random() * 0.25) * difficulty[settings.difficulty]
    }));
    roadside = Array.from({ length: 28 }, (_, i) => ({
      z: (i * 0.071) % 0.98, side: i % 2 ? -1 : 1, type: i % 3 === 0 ? "sign" : (i % 3 === 1 ? "tree" : "post")
    }));
    cones = settings.mode === "training"
      ? Array.from({ length: 10 }, (_, i) => ({ z: 0.08 + i * 0.095, lane: i % 2 ? -0.5 : 0.5, hit: false }))
      : [];
    ui.message.hidden = true;
    ui.hud.hidden = false;
    updateHud();
    draw();
    startCountdown();
  }

  function startCountdown() {
    clearTimeout(countdownTimer);
    let n = 3;
    ui.count.hidden = false;
    const tick = () => {
      ui.count.textContent = n > 0 ? n : "انطلق!";
      if (n < 0) {
        ui.count.hidden = true;
        running = true;
        last = performance.now();
        return;
      }
      n--;
      countdownTimer = setTimeout(tick, 650);
    };
    tick();
  }

  function updateHud() {
    const lap = Math.min(settings.laps, Math.floor(distance / 2600) + 1);
    ui.lap.textContent = settings.mode === "race" ? `${lap} / ${settings.laps}` : "تدريب";
    ui.pos.textContent = settings.mode === "race" ? `1 / ${traffic.length + 1}` : "—";
    ui.time.textContent = fmt(elapsed);
    ui.boost.style.width = `${boost}%`;
  }

  function update(dt) {
    if (!running || paused) return;
    elapsed += dt * 1000;
    const up = keys.has("ArrowUp") || keys.has("w");
    const down = keys.has("ArrowDown") || keys.has("s");
    const turn = (keys.has("ArrowRight") || keys.has("d") ? 1 : 0) - (keys.has("ArrowLeft") || keys.has("a") ? 1 : 0);
    const nitro = keys.has(" ") && up && boost > 0;
    const target = up ? (nitro ? 1.3 : 0.82) : down ? -0.28 : speed * 0.985;
    speed += (target - speed) * Math.min(1, dt * 3.8);
    const steering = settings.vehicle === "bike" ? 1.08 : 0.78;
    playerX = clamp(playerX + turn * dt * (steering + speed * 0.7), -0.92, 0.92);
    boost = nitro ? Math.max(0, boost - dt * 30) : Math.min(100, boost + dt * 7);
    distance += Math.max(0, speed) * dt * 900;
    hitCooldown = Math.max(0, hitCooldown - dt);
    collisionFlash = Math.max(0, collisionFlash - dt);
    traffic.forEach(car => {
      car.z += (speed - car.speed * 0.62) * dt * 0.32;
      if (car.z > 1.05) { car.z = -0.08; car.lane = Math.floor(Math.random() * 3) - 1; }
      car.wobble += dt;
      if (hitCooldown === 0 && car.z > 0.78 && car.z < 0.98 && Math.abs(playerX - car.lane * 0.62) < (settings.vehicle === "bike" ? 0.16 : 0.22)) {
        speed *= 0.32;
        boost = Math.max(0, boost - 22);
        hitCooldown = 0.75;
        collisionFlash = 0.35;
        car.z += 0.08;
        ui.status.textContent = "⚠️ اصطدام! خف السرعة وحاول تاني";
      }
    });
    roadside.forEach(item => {
      item.z += speed * dt * 0.31;
      if (item.z > 1.05) item.z -= 1.08;
    });
    cones.forEach(cone => {
      cone.z += speed * dt * 0.31;
      if (cone.z > 1.05) { cone.z -= 1.08; cone.hit = false; }
      if (!cone.hit && cone.z > 0.82 && Math.abs(playerX - cone.lane) < 0.18) {
        cone.hit = true; speed *= 0.42; boost = Math.max(0, boost - 18);
      }
    });
    if (settings.mode === "race" && distance >= settings.laps * 2600) {
      running = false;
      ui.message.innerHTML = `🏁 أحسنت يا بطل!<small>الوقت ${fmt(elapsed)}</small>`;
      ui.message.hidden = false;
    }
    updateHud();
  }

  function drawBackground(t) {
    const gradient = ctx.createLinearGradient(0, 0, 0, H * horizon);
    gradient.addColorStop(0, t.sky); gradient.addColorStop(1, t.haze);
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, W, H * horizon + 3);
    if (settings.theme === "night") {
      ctx.fillStyle = "#e9f4ff";
      ctx.globalAlpha = 0.9;
      ctx.beginPath(); ctx.arc(W * .78, H * .13, 25, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = t.sky; ctx.beginPath(); ctx.arc(W * .795, H * .12, 22, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.globalAlpha = 0.7;
      for (let i = 0; i < 38; i++) {
        const x = (i * 83 + 31) % W, y = 18 + (i * 47) % (H * .28);
        ctx.fillRect(x, y, i % 3 ? 1 : 2, i % 3 ? 1 : 2);
      }
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = "#fff6cf"; ctx.globalAlpha = 0.8;
      ctx.beginPath(); ctx.arc(W * .8, H * .13, 31, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = settings.theme === "desert" ? "#8f573d" : "#274057";
    ctx.beginPath();
    ctx.moveTo(0, H * horizon); ctx.lineTo(W * .12, H * .3); ctx.lineTo(W * .25, H * .35);
    ctx.lineTo(W * .4, H * .27); ctx.lineTo(W * .58, H * .34); ctx.lineTo(W * .75, H * .25);
    ctx.lineTo(W, H * .32); ctx.lineTo(W, H * horizon); ctx.closePath(); ctx.fill();
    ctx.fillStyle = t.grass; ctx.fillRect(0, H * horizon, W, H);
    ctx.fillStyle = t.grass2;
    for (let i = 0; i < 16; i++) {
      const x = (i * 89 + Math.floor(distance * 0.06) % 89) % W;
      ctx.fillRect(x, H * horizon, 34, H * 0.61);
    }
    ctx.fillStyle = t.haze;
    ctx.globalAlpha = 0.16;
    ctx.fillRect(0, H * horizon - 14, W, 18);
    ctx.globalAlpha = 1;
  }

  function drawRoad(t) {
    const segments = 46;
    for (let i = segments - 1; i >= 0; i--) {
      const z1 = i / segments, z2 = (i + 1) / segments;
      const a = project(z1), b = project(z2);
      const c1 = curveOffset(z1), c2 = curveOffset(z2);
      const left1 = W / 2 + c1 - a.roadHalf, right1 = W / 2 + c1 + a.roadHalf;
      const left2 = W / 2 + c2 - b.roadHalf, right2 = W / 2 + c2 + b.roadHalf;
      ctx.fillStyle = i % 2 ? t.road : t.road2;
      ctx.beginPath(); ctx.moveTo(left1, a.y); ctx.lineTo(right1, a.y); ctx.lineTo(right2, b.y); ctx.lineTo(left2, b.y); ctx.closePath(); ctx.fill();
      ctx.fillStyle = t.edge;
      ctx.beginPath(); ctx.moveTo(left1, a.y); ctx.lineTo(left1 + Math.max(2, a.roadHalf * .035), a.y); ctx.lineTo(left2 + Math.max(2, b.roadHalf * .035), b.y); ctx.lineTo(left2, b.y); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(right1, a.y); ctx.lineTo(right1 - Math.max(2, a.roadHalf * .035), a.y); ctx.lineTo(right2 - Math.max(2, b.roadHalf * .035), b.y); ctx.lineTo(right2, b.y); ctx.closePath(); ctx.fill();
      if (i % 3 !== 0) {
        ctx.fillStyle = t.line;
        for (let lane = 1; lane < 3; lane++) {
          const lx1 = left1 + a.roadHalf * lane / 3, lx2 = left2 + b.roadHalf * lane / 3;
          const mark = Math.max(1.5, a.roadHalf * .018);
          ctx.fillRect(lx1 - mark / 2, a.y, mark, Math.max(2, (b.y - a.y) * .68));
          ctx.fillStyle = t.line;
        }
        if (i % 2 === 0 && i < 35) {
          ctx.globalAlpha = 0.22;
          ctx.fillStyle = "#0e141b";
          for (let grain = 0; grain < 4; grain++) {
            const gx = left2 + ((grain * 37 + i * 19) % 100) / 100 * (right2 - left2);
            ctx.fillRect(gx, b.y - 1, Math.max(1, b.roadHalf * .006), Math.max(1, (b.y - a.y) * .12));
          }
          ctx.globalAlpha = 1;
        }
      }
      const near = project(0);
      ctx.strokeStyle = "#b9c9d0";
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(W / 2 - near.roadHalf, near.y); ctx.lineTo(W / 2 - 42, H * horizon); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(W / 2 + near.roadHalf, near.y); ctx.lineTo(W / 2 + 42, H * horizon); ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  function drawRoadside(t) {
    roadside.slice().sort((a, b) => b.z - a.z).forEach(item => {
      const p = project(item.z, item.side * 1.18);
      const x = W / 2 + curveOffset(item.z) + (p.x - W / 2);
      const size = 10 + p.scale * 46;
      ctx.save();
      if (item.type === "tree") {
        ctx.fillStyle = "#563b2b"; ctx.fillRect(x - size * .08, p.y - size * .3, size * .16, size * .55);
        ctx.fillStyle = t.object; ctx.beginPath(); ctx.arc(x, p.y - size * .48, size * .42, 0, Math.PI * 2); ctx.fill();
      } else if (item.type === "sign") {
        ctx.fillStyle = "#555b62"; ctx.fillRect(x - 2, p.y - size * .7, 4, size * .7);
        ctx.fillStyle = item.side > 0 ? "#e84848" : "#f2c84b"; ctx.fillRect(x - size * .3, p.y - size * .9, size * .6, size * .35);
      } else {
        ctx.fillStyle = "#ece6c9"; ctx.fillRect(x - 2, p.y - size * .42, 4, size * .42);
        if (settings.theme === "night") {
          ctx.fillStyle = "#ffe9a8"; ctx.shadowColor = "#ffe9a8"; ctx.shadowBlur = size * .35;
          ctx.fillRect(x - size * .12, p.y - size * .48, size * .24, size * .12);
          ctx.shadowBlur = 0;
        }
      }
      ctx.restore();
    });
  }

  function drawTraffic(t) {
    traffic.slice().sort((a, b) => b.z - a.z).forEach(car => {
      const p = project(car.z, car.lane * .62 + Math.sin(car.wobble) * .025);
      const x = W / 2 + curveOffset(car.z) + (p.x - W / 2);
      const w = 12 + p.scale * 42, h = w * 1.6;
      ctx.save(); ctx.translate(x, p.y - h * .55);
      ctx.fillStyle = "#0a1018"; ctx.fillRect(-w * .58, h * .42, w * .2, h * .42); ctx.fillRect(w * .38, h * .42, w * .2, h * .42);
      const body = ctx.createLinearGradient(-w / 2, 0, w / 2, h);
      body.addColorStop(0, "#f7f7f7"); body.addColorStop(.08, car.color); body.addColorStop(.78, car.color); body.addColorStop(1, "#171d25");
      ctx.fillStyle = body; ctx.beginPath(); ctx.roundRect(-w / 2, 0, w, h, w * .15); ctx.fill();
      ctx.fillStyle = "#111923"; ctx.beginPath(); ctx.roundRect(-w * .32, h * .09, w * .64, h * .3, w * .08); ctx.fill();
      const glass = ctx.createLinearGradient(0, h * .1, 0, h * .36);
      glass.addColorStop(0, "#e5fbff"); glass.addColorStop(.45, "#70a9bd"); glass.addColorStop(1, "#213747");
      ctx.fillStyle = glass; ctx.beginPath(); ctx.roundRect(-w * .26, h * .13, w * .52, h * .2, w * .04); ctx.fill();
      ctx.fillStyle = "#fff1bd"; ctx.shadowColor = "#fff1bd"; ctx.shadowBlur = w * .2;
      ctx.fillRect(-w * .35, h * .78, w * .18, h * .1); ctx.fillRect(w * .17, h * .78, w * .18, h * .1);
      ctx.shadowBlur = 0;
      ctx.restore();
    });
    cones.forEach(cone => {
      const p = project(cone.z, cone.lane * .62);
      const size = 5 + p.scale * 22;
      ctx.fillStyle = cone.hit ? "#777" : "#ff8c35";
      ctx.beginPath(); ctx.moveTo(p.x, p.y - size); ctx.lineTo(p.x - size * .55, p.y); ctx.lineTo(p.x + size * .55, p.y); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.fillRect(p.x - size * .3, p.y - size * .38, size * .6, Math.max(1, size * .13));
    });
  }

  function drawBike() {
    const x = W / 2 + playerX * 75;
    ctx.save(); ctx.translate(x, H - 24);
    ctx.fillStyle = "#080d13"; ctx.shadowColor = "#000"; ctx.shadowBlur = 18; ctx.beginPath(); ctx.ellipse(0, 4, 56, 20, 0, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
    ctx.fillStyle = "#0a1017"; ctx.beginPath(); ctx.ellipse(0, -5, 11, 64, 0, 0, Math.PI * 2); ctx.fill();
    const bikeBody = ctx.createLinearGradient(-28, -50, 28, 15);
    bikeBody.addColorStop(0, "#ff6d72"); bikeBody.addColorStop(.4, "#d62e4a"); bikeBody.addColorStop(1, "#421b2a");
    ctx.fillStyle = bikeBody; ctx.beginPath(); ctx.moveTo(-28, 7); ctx.lineTo(-18, -48); ctx.quadraticCurveTo(0, -62, 18, -48); ctx.lineTo(28, 7); ctx.quadraticCurveTo(0, 21, -28, 7); ctx.fill();
    ctx.fillStyle = "#101c29"; ctx.beginPath(); ctx.moveTo(-14, -43); ctx.lineTo(14, -43); ctx.lineTo(20, -12); ctx.lineTo(-20, -12); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#9fd4e0"; ctx.globalAlpha = .85; ctx.beginPath(); ctx.moveTo(-10, -40); ctx.lineTo(10, -40); ctx.lineTo(14, -20); ctx.lineTo(-14, -20); ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
    ctx.fillStyle = "#f9e9ae"; ctx.shadowColor = "#fff1aa"; ctx.shadowBlur = 25; ctx.fillRect(-13, -48, 26, 7); ctx.shadowBlur = 0;
    ctx.strokeStyle = "#b8d7e0"; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(-22, -30); ctx.lineTo(-56, -15); ctx.moveTo(22, -30); ctx.lineTo(56, -15); ctx.stroke();
    ctx.fillStyle = "#111"; ctx.beginPath(); ctx.ellipse(-57, -14, 8, 5, -.2, 0, Math.PI * 2); ctx.ellipse(57, -14, 8, 5, .2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawCarPlayer() {
    const x = W / 2 + playerX * 75;
    ctx.save(); ctx.translate(x, H - 28);
    ctx.fillStyle = "#080d13"; ctx.shadowColor = "#000"; ctx.shadowBlur = 22; ctx.beginPath(); ctx.ellipse(0, 8, 74, 20, 0, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
    const body = ctx.createLinearGradient(-70, -48, 70, 18);
    body.addColorStop(0, "#ff6871"); body.addColorStop(.25, "#df3348"); body.addColorStop(.8, "#a51f36"); body.addColorStop(1, "#391829");
    ctx.fillStyle = body; ctx.beginPath(); ctx.roundRect(-67, -50, 134, 61, 16); ctx.fill();
    ctx.fillStyle = "#101a25"; ctx.beginPath(); ctx.moveTo(-39, -46); ctx.lineTo(39, -46); ctx.lineTo(52, -13); ctx.lineTo(-52, -13); ctx.closePath(); ctx.fill();
    const glass = ctx.createLinearGradient(0, -42, 0, -14);
    glass.addColorStop(0, "#d6f7fa"); glass.addColorStop(.4, "#6da7b7"); glass.addColorStop(1, "#203747");
    ctx.fillStyle = glass; ctx.beginPath(); ctx.moveTo(-31, -42); ctx.lineTo(31, -42); ctx.lineTo(39, -18); ctx.lineTo(-39, -18); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#f9e9ae"; ctx.shadowColor = "#fff1aa"; ctx.shadowBlur = 25; ctx.fillRect(-51, -36, 18, 8); ctx.fillRect(33, -36, 18, 8); ctx.shadowBlur = 0;
    ctx.fillStyle = "#0c1118"; ctx.fillRect(-62, -1, 23, 21); ctx.fillRect(39, -1, 23, 21);
    ctx.fillStyle = "#ff3449"; ctx.fillRect(-38, 0, 76, 5);
    ctx.restore();
  }

  function drawPlayer() {
    if (settings.vehicle === "bike") drawBike();
    else drawCarPlayer();
  }

  function draw() {
    const t = themes[settings.theme];
    ctx.clearRect(0, 0, W, H);
    drawBackground(t); drawRoad(t); drawRoadside(t); drawTraffic(t); drawPlayer();
    if (speed > 0.9 && running) {
      ctx.globalAlpha = 0.12;
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 2;
      for (let i = 0; i < 9; i++) { const x = (i * 137 + distance * 3) % W; ctx.beginPath(); ctx.moveTo(x, H * .56); ctx.lineTo(x + (x - W / 2) * .2, H); ctx.stroke(); }
      ctx.globalAlpha = 1;
    }
    if (collisionFlash > 0) {
      ctx.fillStyle = `rgba(255, 75, 55, ${collisionFlash * 0.7})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now; update(dt); draw(); raf = requestAnimationFrame(loop);
  }
  function start() {
    ui.setup.hidden = true; reset(); cancelAnimationFrame(raf); raf = requestAnimationFrame(loop);
    ui.status.textContent = settings.mode === "training" ? "تدريب: تفادى الأقماع" : "الطريق مفتوح — دوس بنزين!";
  }

  document.querySelectorAll(".vehicle-choices .choice").forEach(button => button.onclick = () => {
    document.querySelectorAll(".vehicle-choices .choice").forEach(item => item.classList.remove("active"));
    button.classList.add("active"); settings.vehicle = button.dataset.vehicle;
  });
  document.querySelectorAll(".theme-choices .choice").forEach(button => button.onclick = () => {
    document.querySelectorAll(".theme-choices .choice").forEach(item => item.classList.remove("active"));
    button.classList.add("active"); settings.theme = button.dataset.theme;
  });
  document.querySelectorAll("[data-mode]").forEach(button => button.onclick = () => {
    document.querySelectorAll("[data-mode]").forEach(item => item.classList.remove("active"));
    button.classList.add("active"); settings.mode = button.dataset.mode;
  });
  document.querySelectorAll("[data-difficulty]").forEach(button => button.onclick = () => {
    document.querySelectorAll("[data-difficulty]").forEach(item => item.classList.remove("active"));
    button.classList.add("active"); settings.difficulty = button.dataset.difficulty;
  });
  document.querySelectorAll("[data-laps]").forEach(button => button.onclick = () => {
    document.querySelectorAll("[data-laps]").forEach(item => item.classList.remove("active"));
    button.classList.add("active"); settings.laps = Number(button.dataset.laps);
  });
  $("#enterGameBtn").onclick = () => { ui.welcome.hidden = true; ui.welcome.style.display = "none"; ui.shell.hidden = false; };
  $("#startBtn").onclick = start;
  $("#backBtn").onclick = () => { running = false; ui.setup.hidden = false; ui.hud.hidden = true; };
  $("#pauseBtn").onclick = () => { paused = !paused; ui.pause.textContent = paused ? "▶" : "Ⅱ"; };
  $("#soundBtn").onclick = () => { muted = !muted; ui.sound.textContent = muted ? "🔇" : "🔊"; };
  $("#fullscreenBtn").onclick = () => document.documentElement.requestFullscreen?.();
  addEventListener("keydown", event => {
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " ", "w", "a", "s", "d"].includes(key)) { event.preventDefault(); keys.add(key); }
    if (key === "p") ui.pause.click();
  });
  addEventListener("keyup", event => keys.delete(event.key.length === 1 ? event.key.toLowerCase() : event.key));
  document.querySelectorAll(".touch-button").forEach(button => {
    const key = button.dataset.key;
    const release = event => { event.preventDefault(); keys.delete(key); button.classList.remove("pressed"); };
    button.addEventListener("pointerdown", event => { event.preventDefault(); keys.add(key); button.classList.add("pressed"); button.setPointerCapture?.(event.pointerId); });
    button.addEventListener("pointerup", release); button.addEventListener("pointercancel", release);
  });
  addEventListener("deviceorientation", event => {
    keys.delete("ArrowLeft"); keys.delete("ArrowRight");
    if (Math.abs(event.gamma || 0) > 8) keys.add(event.gamma > 0 ? "ArrowRight" : "ArrowLeft");
  });
  ui.shell.hidden = true;
  draw();
})();
