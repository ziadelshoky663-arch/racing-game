(() => {
  "use strict";
  const canvas = document.querySelector("#gameCanvas");
  const ctx = canvas.getContext("2d");
  const ui = {
    lap: document.querySelector("#lapValue"), position: document.querySelector("#positionValue"),
    time: document.querySelector("#timeValue"), boost: document.querySelector("#boostBar"),
    countdown: document.querySelector("#countdown"), message: document.querySelector("#message"),
    restart: document.querySelector("#restartBtn"), pause: document.querySelector("#pauseBtn"),
    sound: document.querySelector("#soundBtn"), modes: [...document.querySelectorAll(".mode-card")]
  };
  document.querySelector("#enterGameBtn").addEventListener("click", () => {
    document.querySelector("#welcomeScreen").hidden = true;
  });
  const W = canvas.width, H = canvas.height;
  const track = { cx: W / 2, cy: H / 2 + 5, rx: 320, ry: 205, width: 112 };
  const keys = new Set();
  let mode = "race", running = false, paused = false, countdown = 0, last = 0, elapsed = 0, soundOn = true, animation;
  let player, cars = [], obstacles = [];

  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const formatTime = (ms) => {
    const seconds = ms / 1000;
    return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${(seconds % 60).toFixed(1).padStart(4, "0")}`;
  };
  const pointOnTrack = (angle, lane = 0) => ({
    x: track.cx + (track.rx + lane) * Math.cos(angle),
    y: track.cy + (track.ry + lane * .64) * Math.sin(angle)
  });
  const angleOf = (car) => Math.atan2((car.y - track.cy) / track.ry, (car.x - track.cx) / track.rx);
  const progressOf = (car) => {
    let angle = angleOf(car);
    if (angle < -Math.PI / 2) angle += Math.PI * 2;
    return angle < -Math.PI / 2 ? angle + Math.PI * 2 : angle;
  };
  function makeCar(color, angle, lane, ai = false) {
    const p = pointOnTrack(angle, lane);
    return { x: p.x, y: p.y, angle: angle + Math.PI / 2, color, lane, ai, speed: ai ? 85 + Math.random() * 22 : 0, progress: 0, lap: 0, boost: 100, width: 20, height: 37 };
  }
  function reset() {
    player = makeCar("#45d9e8", -Math.PI / 2, 0);
    cars = [player, makeCar("#ff597c", -Math.PI / 2 - .18, -27, true), makeCar("#b26dff", -Math.PI / 2 - .36, 27, true), makeCar("#f3e85e", -Math.PI / 2 - .53, -27, true), makeCar("#62e58c", -Math.PI / 2 - .72, 27, true)];
    obstacles = [];
    if (mode === "training") {
      [-1.12, -.37, .42, 1.14, 2.02, 2.72].forEach((a, i) => obstacles.push({ ...pointOnTrack(a, i % 2 ? 28 : -28), angle: a }));
    }
    elapsed = 0; countdown = 3; running = false; paused = false;
    ui.message.hidden = true; ui.countdown.hidden = false; ui.restart.textContent = "إعادة البدء";
    updateHud();
  }
  function updateHud() {
    const completed = Math.min(3, player ? player.lap + 1 : 1);
    ui.lap.textContent = mode === "race" ? `${completed} / 3` : "تدريب";
    const sorted = [...cars].sort((a, b) => (b.lap * 6.28 + progressOf(b)) - (a.lap * 6.28 + progressOf(a)));
    ui.position.textContent = mode === "race" ? `${sorted.indexOf(player) + 1} / 5` : "—";
    ui.time.textContent = formatTime(elapsed);
    ui.boost.style.width = `${player ? player.boost : 100}%`;
  }
  function startCountdown() {
    const tick = () => {
      ui.countdown.textContent = countdown > 0 ? countdown : "انطلق!";
      if (countdown < 0) { ui.countdown.hidden = true; running = true; last = performance.now(); return; }
      countdown -= 1; setTimeout(tick, 700);
    };
    tick();
  }
  function update(dt) {
    if (!running || paused) return;
    elapsed += dt * 1000;
    const accelerating = keys.has("ArrowUp") || keys.has("w");
    const braking = keys.has("ArrowDown") || keys.has("s");
    const turning = (keys.has("ArrowLeft") || keys.has("a") ? -1 : 0) + (keys.has("ArrowRight") || keys.has("d") ? 1 : 0);
    const nitro = keys.has(" ") && player.boost > 0 && accelerating;
    const target = accelerating ? (nitro ? 270 : 190) : braking ? -75 : 0;
    player.speed += (target - player.speed) * Math.min(1, dt * 4);
    if (nitro) player.boost = Math.max(0, player.boost - dt * 26); else player.boost = Math.min(100, player.boost + dt * 6);
    player.angle += turning * dt * (1.9 + Math.abs(player.speed) / 180);
    player.x += Math.cos(player.angle - Math.PI / 2) * player.speed * dt;
    player.y += Math.sin(player.angle - Math.PI / 2) * player.speed * dt;
    keepOnTrack(player);
    moveAi(dt);
    if (mode === "training") checkObstacles();
    checkLap(player);
    updateHud();
  }
  function keepOnTrack(car) {
    const nx = (car.x - track.cx) / track.rx, ny = (car.y - track.cy) / track.ry;
    const distance = Math.sqrt(nx * nx + ny * ny);
    if (distance > 1.13) { car.x -= Math.cos(car.angle - Math.PI / 2) * car.speed * .04; car.y -= Math.sin(car.angle - Math.PI / 2) * car.speed * .04; car.speed *= .82; }
  }
  function moveAi(dt) {
    cars.slice(1).forEach(car => {
      const speed = car.speed * (mode === "training" ? .75 : 1);
      const angle = angleOf(car) + speed / track.rx * dt;
      const p = pointOnTrack(angle, car.lane);
      car.x = p.x; car.y = p.y; car.angle = angle + Math.PI / 2; car.progress += speed * dt / 100;
      checkLap(car);
    });
  }
  function checkLap(car) {
    const progress = progressOf(car);
    if (car.lastProgress !== undefined && progress < 1 && car.lastProgress > 5) car.lap += 1;
    car.lastProgress = progress;
    if (car === player && mode === "race" && car.lap >= 3) finish();
  }
  function checkObstacles() {
    obstacles.forEach(obstacle => {
      if (Math.hypot(player.x - obstacle.x, player.y - obstacle.y) < 27) {
        player.speed *= .45; player.boost = Math.max(0, player.boost - 12);
        obstacle.hit = true; setTimeout(() => { obstacle.hit = false; }, 250);
      }
    });
  }
  function finish() {
    running = false; ui.message.hidden = false;
    const sorted = [...cars].sort((a, b) => (b.lap * 6.28 + progressOf(b)) - (a.lap * 6.28 + progressOf(a)));
    ui.message.innerHTML = `🏁 انتهى السباق!<small>أنهيت السباق في المركز ${sorted.indexOf(player) + 1} — ${formatTime(elapsed)}</small>`;
  }
  function draw() {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#18304a"; ctx.fillRect(0, 0, W, H);
    drawGrid(); drawTrack(); obstacles.forEach(drawObstacle); cars.slice().sort((a, b) => a.y - b.y).forEach(drawCar);
    animation = requestAnimationFrame(loop);
  }
  function drawGrid() {
    ctx.strokeStyle = "#24405a"; ctx.lineWidth = 1;
    for (let x = 0; x < W; x += 32) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 0; y < H; y += 32) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  }
  function oval(fill, rx, ry, line, width = 1) {
    ctx.beginPath(); ctx.ellipse(track.cx, track.cy, rx, ry, 0, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill();
    if (line) { ctx.strokeStyle = line; ctx.lineWidth = width; ctx.stroke(); }
  }
  function drawTrack() {
    oval("#101521", track.rx + 73, track.ry + 73);
    oval("#2f3540", track.rx + 58, track.ry + 58);
    oval("#111725", track.rx - 54, track.ry - 54);
    ctx.setLineDash([12, 14]); oval("transparent", track.rx + 2, track.ry + 2, "#f5d774", 3); ctx.setLineDash([]);
    ctx.strokeStyle = "#dfe7ef"; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(track.cx - 6, track.cy - track.ry - 55); ctx.lineTo(track.cx + 24, track.cy - track.ry - 55); ctx.stroke();
    for (let i = 0; i < 6; i++) { ctx.fillStyle = i % 2 ? "#172033" : "#f4f4e9"; ctx.fillRect(track.cx - 6 + i * 5, track.cy - track.ry - 61, 5, 12); }
  }
  function drawObstacle(obstacle) {
    ctx.save(); ctx.translate(obstacle.x, obstacle.y); ctx.rotate(obstacle.angle + Math.PI / 2);
    ctx.fillStyle = obstacle.hit ? "#fff" : "#ff9d38"; ctx.beginPath(); ctx.moveTo(0, -13); ctx.lineTo(11, 12); ctx.lineTo(-11, 12); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#fff1bd"; ctx.fillRect(-6, 1, 12, 4); ctx.restore();
  }
  function drawCar(car) {
    ctx.save(); ctx.translate(car.x, car.y); ctx.rotate(car.angle);
    ctx.shadowColor = "#0008"; ctx.shadowBlur = 10; ctx.shadowOffsetY = 4;
    ctx.fillStyle = car.color; ctx.beginPath(); ctx.roundRect(-10, -19, 20, 38, 6); ctx.fill();
    ctx.shadowColor = "transparent"; ctx.fillStyle = "#b9d1df"; ctx.beginPath(); ctx.roundRect(-7, -11, 14, 11, 3); ctx.fill();
    ctx.fillStyle = "#20334c"; ctx.fillRect(-7, 4, 14, 7);
    ctx.fillStyle = "#f4f5d5"; ctx.fillRect(-7, -18, 5, 3); ctx.fillRect(2, -18, 5, 3);
    ctx.restore();
  }
  function loop(now) { const dt = Math.min(.05, (now - last) / 1000); last = now; update(dt); draw(); }
  function begin() { cancelAnimationFrame(animation); reset(); startCountdown(); animation = requestAnimationFrame(loop); }
  ui.modes.forEach(button => button.addEventListener("click", () => {
    ui.modes.forEach(item => item.classList.toggle("active", item === button)); mode = button.dataset.mode; begin();
  }));
  ui.restart.addEventListener("click", begin);
  ui.pause.addEventListener("click", () => { if (!running) return; paused = !paused; ui.pause.textContent = paused ? "▶" : "Ⅱ"; });
  ui.sound.addEventListener("click", () => { soundOn = !soundOn; ui.sound.textContent = soundOn ? "🔊" : "🔇"; });
  window.addEventListener("keydown", event => {
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " ", "w", "a", "s", "d"].includes(key)) { event.preventDefault(); keys.add(key); }
    if (key === "p") ui.pause.click();
  });
  window.addEventListener("keyup", event => keys.delete(event.key.length === 1 ? event.key.toLowerCase() : event.key));
  document.querySelectorAll(".touch-button").forEach(button => {
    const key = button.dataset.key;
    const press = event => {
      event.preventDefault();
      keys.add(key);
      button.classList.add("pressed");
    };
    const release = event => {
      event.preventDefault();
      keys.delete(key);
      button.classList.remove("pressed");
    };
    button.addEventListener("pointerdown", press);
    button.addEventListener("pointerup", release);
    button.addEventListener("pointercancel", release);
    button.addEventListener("pointerleave", release);
  });
  begin();
})();
