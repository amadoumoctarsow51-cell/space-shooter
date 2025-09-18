/* game.js — Space Shooter Pro (Amadou)
   Fonctionnalités:
   - responsive canvas handling (DPR)
   - player ship with boost/accelerate, flame visual
   - bullets with cooldown
   - asteroids with hp & rotation
   - aliens appear after score >= 50, zig/straight behavior
   - power-ups: shield (life +1) & slow (slow down enemies)
   - particles for explosions
   - HUD updated in DOM (score, lives, level, best)
   - start / tutorial / game over overlays
   - sounds optional (assets/sounds/*)
   - touch support for mobile (left/right/shot/boost)
*/

/* --------------------------
   CONFIG / ASSETS
   -------------------------- */
const CONFIG = {
  assetPath: 'assets/', // put your images and sounds there (optional)
  sounds: {
    music: 'music.mp3',
    shoot: 'shoot.wav',
    explode: 'explode.wav',
    power: 'power.wav'
  },
  images: {
    ship: 'ship.png',        // optional ship texture (transparent PNG)
    flame: 'flame.png',      // optional flame sprite
    asteroid: 'asteroid.png',
    alien: 'alien.png',
    starfield: 'stars-bg.jpg' // background tile (optional)
  },
  initialLives: 3,
  spawnIntervalMs: 900,
  difficultyIncreaseEverySec: 30, // every 30s increase difficulty
  levelScoreStep: 25
};

// utility to build URL or return null if not present
function assetUrl(filename){ return filename ? (CONFIG.assetPath + filename) : null; }

/* --------------------------
   CANVAS & RENDER SETUP
   -------------------------- */
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

function fitCanvas() {
  // parent width, set height relative to viewport
  const parentRect = canvas.parentElement.getBoundingClientRect();
  const w = Math.max(320, parentRect.width);
  const h = Math.max(320, Math.floor(window.innerHeight * 0.68));
  const ratio = window.devicePixelRatio || 1;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  canvas.width = Math.floor(w * ratio);
  canvas.height = Math.floor(h * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}
window.addEventListener('resize', () => { fitCanvas(); });
fitCanvas();

/* --------------------------
   DOM references & UI
   -------------------------- */
const domScore = document.getElementById('domScore');
const domLives = document.getElementById('domLives');
const domLevel = document.getElementById('domLevel');
const domBest = document.getElementById('domBest');
const btnStart = document.getElementById('btnStart');
const btnTutorial = document.getElementById('btnTutorial');
const btnTutorialClose = document.getElementById('btnTutorialClose');
const centerOverlay = document.getElementById('centerOverlay');
const tutorialOverlay = document.getElementById('tutorialOverlay');
const gameOverOverlay = document.getElementById('gameOverOverlay');
const btnReplay = document.getElementById('btnReplay');
const btnMainMenu = document.getElementById('btnMainMenu');

/* touch controls */
const touchLeft = document.getElementById('touchLeft');
const touchRight = document.getElementById('touchRight');
const touchShoot = document.getElementById('touchShoot');
const touchBoost = document.getElementById('touchBoost');

/* --------------------------
   AUDIO LOADER (safe)
   -------------------------- */
function safeAudio(src, loop=false, volume=0.6) {
  try {
    const a = new Audio(src);
    a.loop = loop;
    a.volume = volume;
    a.preload = 'auto';
    return a;
  } catch (e) {
    return { play: ()=>{}, pause: ()=>{}, currentTime: 0 };
  }
}

/* load sounds if present */
const sndMusic = safeAudio(assetUrl(CONFIG.sounds.music), true, 0.45);
const sndShoot = safeAudio(assetUrl(CONFIG.sounds.shoot), false, 0.8);
const sndExplode = safeAudio(assetUrl(CONFIG.sounds.explode), false, 0.9);
const sndPower = safeAudio(assetUrl(CONFIG.sounds.power), false, 0.8);

/* --------------------------
   IMAGE LOADER (optional)
   -------------------------- */
function loadImage(path){
  return new Promise((resolve) => {
    if (!path) return resolve(null);
    const img = new Image();
    img.src = path;
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
  });
}

/* Preload images (not required, fallback drawn shapes exist) */
let IMG = {};
(async function preloadImages(){
  IMG.ship = await loadImage(assetUrl(CONFIG.images.ship));
  IMG.flame = await loadImage(assetUrl(CONFIG.images.flame));
  IMG.asteroid = await loadImage(assetUrl(CONFIG.images.asteroid));
  IMG.alien = await loadImage(assetUrl(CONFIG.images.alien));
  IMG.starfield = await loadImage(assetUrl(CONFIG.images.starfield));
})();

/* --------------------------
   GAME STATE
   -------------------------- */
let running = false;
let paused = false;
let score = 0;
let lives = CONFIG.initialLives;
let best = Number(localStorage.getItem('ss_best') || 0);
let level = 1;
domBest.textContent = best;

/* Entities */
const player = {
  w: 56, h: 44, x: 0, y: 0,
  vx: 0, baseSpeed: 320,
  shootCooldown: 0, boost: false
};

const bullets = [];
const asteroids = [];
const aliens = [];
const powerups = [];
const particles = [];

/* timers */
let spawnTimer = 0;
let spawnInterval = CONFIG.spawnIntervalMs;
let lastTime = 0;
let difficultyTimer = 0;
let gameStartTime = 0;
let slowEffect = false;
let slowTimer = 0;

/* --------------------------
   HELPERS
   -------------------------- */
const rand = (a,b) => Math.random()*(b-a)+a;
function rectsCollide(a,b){
  return !(a.x + a.w < b.x || a.x > b.x + b.w || a.y + a.h < b.y || a.y > b.y + b.h);
}

/* HUD update with small flash */
function updateHUD(){
  domScore.textContent = score;
  domLives.textContent = lives;
  domLevel.textContent = level;
  // small highlight when changed (simple approach)
  // (for brevity we skip animation toggles here)
}

/* --------------------------
   SPAWNERS
   -------------------------- */
function spawnAsteroid(){
  const rect = canvas.getBoundingClientRect();
  const size = Math.floor(rand(22, 84));
  asteroids.push({
    x: rand(8, rect.width - size - 8),
    y: -size - 10,
    w: size, h: size,
    rot: rand(0, Math.PI*2),
    rotSpeed: rand(-1.5, 1.5),
    speed: rand(80, 220) + Math.min(score * 2, 520),
    hp: Math.max(1, Math.ceil(size / 28))
  });
}

function spawnAlien(){
  const rect = canvas.getBoundingClientRect();
  aliens.push({
    x: rand(20, rect.width - 60),
    y: -50, w: 48, h: 36,
    speed: rand(60, 140),
    hp: 2,
    behavior: Math.random() < 0.5 ? 'zig' : 'straight',
    t: 0
  });
}

function spawnPowerup(){
  const rect = canvas.getBoundingClientRect();
  powerups.push({
    x: rand(24, rect.width - 44),
    y: -30, w: 22, h: 22,
    type: Math.random() < 0.5 ? 'shield' : 'slow'
  });
}

/* --------------------------
   PARTICLES & EFFECTS
   -------------------------- */
function emitExplosion(cx, cy, color='#ffb86b', count=18){
  for (let i=0;i<count;i++){
    particles.push({
      x: cx + rand(-6,6),
      y: cy + rand(-6,6),
      vx: rand(-280,280),
      vy: rand(-260,50),
      life: rand(0.45, 1.05),
      age: 0,
      size: rand(2,5),
      color
    });
  }
}

/* --------------------------
   START / RESET / END
   -------------------------- */
function startGame(){
  // reset state
  score = 0;
  lives = CONFIG.initialLives;
  level = 1;
  slowEffect = false; slowTimer = 0;
  asteroids.length = 0; aliens.length = 0; bullets.length = 0; powerups.length = 0; particles.length = 0;
  spawnTimer = 0; spawnInterval = CONFIG.spawnIntervalMs;
  gameStartTime = performance.now();
  difficultyTimer = 0;
  lastTime = 0;
  running = true; paused = false;
  fitCanvas();
  const r = canvas.getBoundingClientRect();
  player.x = Math.floor(r.width/2 - player.w/2);
  player.y = r.height - player.h - 18;
  player.vx = 0;
  // start music if present
  sndMusic.play().catch(()=>{});
  centerOverlay.classList.add('hidden');
  gameOverOverlay.classList.add('hidden');
  updateHUD();
}

function endGame(){
  running = false;
  sndMusic.pause();
  emitExplosion(player.x + player.w/2, player.y + player.h/2, '#ff8b8b', 36);
  // show overlay and final score
  document.getElementById('finalScore').textContent = score;
  const bestNow = Math.max(best, score);
  document.getElementById('finalBest').textContent = bestNow;
  if (score > best){ best = score; localStorage.setItem('ss_best', best); domBest.textContent = best; }
  gameOverOverlay.classList.remove('hidden');
}

/* --------------------------
   INPUT (keyboard & touch)
   -------------------------- */
const keys = {};
window.addEventListener('keydown', (e) => {
  keys[e.key] = true;
  if (e.key === ' ') e.preventDefault(); // prevent page scroll
});
window.addEventListener('keyup', (e) => { keys[e.key] = false; });

// touch events
touchLeft?.addEventListener('touchstart', e => { e.preventDefault(); keys.touchLeft = true; });
touchLeft?.addEventListener('touchend', e => { e.preventDefault(); keys.touchLeft = false; });
touchRight?.addEventListener('touchstart', e => { e.preventDefault(); keys.touchRight = true; });
touchRight?.addEventListener('touchend', e => { e.preventDefault(); keys.touchRight = false; });
touchShoot?.addEventListener('touchstart', e => { e.preventDefault(); keys.touchShoot = true; });
touchShoot?.addEventListener('touchend', e => { e.preventDefault(); keys.touchShoot = false; });
touchBoost?.addEventListener('touchstart', e => { e.preventDefault(); keys.touchBoost = true; });
touchBoost?.addEventListener('touchend', e => { e.preventDefault(); keys.touchBoost = false; });

/* --------------------------
   SHOOTING
   -------------------------- */
function tryShoot(){
  if (!running || paused) return;
  if (player.shootCooldown && player.shootCooldown > 0) return;
  bullets.push({
    x: player.x + player.w/2 - 5,
    y: player.y - 10,
    w: 10, h: 16,
    speed: 720
  });
  player.shootCooldown = 220; // ms
  sndShoot.play().catch(()=>{});
  setTimeout(()=>{ player.shootCooldown = 0; }, 220);
}

/* continuous shooting interval (for held keys) */
setInterval(() => {
  if (!running || paused) return;
  if (keys[' '] || keys.touchShoot) tryShoot();
}, 80);

/* --------------------------
   UPDATE LOOP
   -------------------------- */
function update(dt){
  if (!running || paused) return;

  // handle level by time or score
  difficultyTimer += dt;
  if (difficultyTimer >= CONFIG.difficultyIncreaseEverySec){
    difficultyTimer = 0;
    level += 1;
    spawnInterval = Math.max(320, spawnInterval - 60);
  }

  // inputs
  const left = keys['ArrowLeft'] || keys['a'] || keys['A'] || keys.touchLeft;
  const right = keys['ArrowRight'] || keys['d'] || keys['D'] || keys.touchRight;
  const up = keys['ArrowUp'] || keys['w'] || keys['W'] || keys.touchBoost;
  const shoot = keys[' '] || keys.touchShoot;

  // movement & boost
  const speed = player.baseSpeed * (up ? 1.6 : 1);
  if (left) player.vx = -speed;
  else if (right) player.vx = speed;
  else player.vx = 0;
  player.x += player.vx * dt;

  // clamp to area
  const rect = canvas.getBoundingClientRect();
  if (player.x < 8) player.x = 8;
  if (player.x + player.w > rect.width - 8) player.x = rect.width - 8 - player.w;

  // shoot handled by interval and tryShoot

  // spawn timer (also auto spawner below creates some)
  spawnTimer += dt*1000;
  if (spawnTimer > spawnInterval){
    spawnTimer = 0;
    spawnAsteroid();
    if (Math.random() < 0.12) spawnPowerup();
  }

  // alien spawn if score >= 50
  if (score >= 50 && Math.random() < 0.01) spawnAlien();

  // update bullets
  for (let i = bullets.length-1; i >= 0; i--){
    const b = bullets[i];
    b.y -= b.speed * dt;
    if (b.y < -30) bullets.splice(i,1);
  }

  // update asteroids
  for (let i = asteroids.length-1; i >= 0; i--){
    const a = asteroids[i];
    a.y += a.speed * dt * (slowEffect ? 0.45 : 1);
    a.rot += (a.rotSpeed || 0) * dt;
    if (a.y > rect.height + 80) asteroids.splice(i,1);
  }

  // update aliens
  for (let i = aliens.length-1; i >= 0; i--){
    const al = aliens[i];
    al.t += dt;
    if (al.behavior === 'zig') al.x += Math.sin(al.t * 4) * 80 * dt;
    al.y += al.speed * dt * (slowEffect ? 0.45 : 1);
    if (al.y > rect.height + 80) aliens.splice(i,1);
  }

  // update powerups
  for (let i = powerups.length-1; i >= 0; i--){
    const p = powerups[i];
    p.y += 110 * dt;
    if (p.y > rect.height + 40) powerups.splice(i,1);
  }

  // bullet collisions with asteroids / aliens
  for (let i = bullets.length-1; i >= 0; i--){
    const b = bullets[i];
    let hit = false;
    for (let j = asteroids.length-1; j >= 0; j--){
      const a = asteroids[j];
      if (rectsCollide({x:b.x,y:b.y,w:b.w,h:b.h},{x:a.x,y:a.y,w:a.w,h:a.h})){
        bullets.splice(i,1);
        a.hp = (a.hp || 1) - 1;
        if (a.hp <= 0){
          emitExplosion(a.x + a.w/2, a.y + a.h/2, '#ffb86b', 12);
          sndExplode.play().catch(()=>{});
          asteroids.splice(j,1);
          score += 1;
          domScore.textContent = score;
        }
        hit = true;
        break;
      }
    }
    if (hit) continue;
    for (let j = aliens.length-1; j >= 0; j--){
      const al = aliens[j];
      if (rectsCollide({x:b.x,y:b.y,w:b.w,h:b.h},{x:al.x,y:al.y,w:al.w,h:al.h})){
        bullets.splice(i,1);
        al.hp -= 1;
        if (al.hp <= 0){
          emitExplosion(al.x + al.w/2, al.y + al.h/2, '#ff6b6b', 20);
          sndExplode.play().catch(()=>{});
          aliens.splice(j,1);
          score += 5;
          domScore.textContent = score;
        }
        break;
      }
    }
  }

  // player <-> asteroid collisions
  for (let i = asteroids.length-1; i >= 0; i--){
    const a = asteroids[i];
    if (rectsCollide({x:player.x,y:player.y,w:player.w,h:player.h},{x:a.x,y:a.y,w:a.w,h:a.h})){
      emitExplosion(player.x + player.w/2, player.y + player.h/2, '#99d', 20);
      sndExplode.play().catch(()=>{});
      asteroids.splice(i,1);
      lives -= 1;
      domLives.textContent = lives;
      if (lives <= 0){ endGame(); return; }
    }
  }

  // player <-> alien collisions
  for (let i = aliens.length-1; i >= 0; i--){
    const al = aliens[i];
    if (rectsCollide({x:player.x,y:player.y,w:player.w,h:player.h},{x:al.x,y:al.y,w:al.w,h:al.h})){
      emitExplosion(player.x + player.w/2, player.y + player.h/2, '#f66', 26);
      sndExplode.play().catch(()=>{});
      aliens.splice(i,1);
      lives -= 1;
      domLives.textContent = lives;
      if (lives <= 0){ endGame(); return; }
    }
  }

  // player <-> powerups
  for (let i = powerups.length-1; i >= 0; i--){
    const p = powerups[i];
    if (rectsCollide({x:player.x,y:player.y,w:player.w,h:player.h},{x:p.x,y:p.y,w:p.w,h:p.h})){
      sndPower.play().catch(()=>{});
      if (p.type === 'shield'){
        lives = Math.min(lives + 1, 6);
        domLives.textContent = lives;
      } else {
        slowEffect = true;
        slowTimer = 5.0;
      }
      powerups.splice(i,1);
    }
  }

  // particles
  for (let i = particles.length-1; i >= 0; i--){
    const p = particles[i];
    p.age += dt;
    if (p.age >= p.life) particles.splice(i,1);
    else {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 350 * dt;
    }
  }

  // slow timer
  if (slowEffect){
    slowTimer -= dt;
    if (slowTimer <= 0) slowEffect = false;
  }

  // update best if needed
  if (score > best){
    best = score;
    domBest.textContent = best;
    localStorage.setItem('ss_best', best);
  }

  // level by score
  level = Math.floor(score / CONFIG.levelScoreStep) + 1;
  domLevel.textContent = level;
}

/* --------------------------
   DRAWING
   -------------------------- */
function draw(){
  const rect = canvas.getBoundingClientRect();
  // clear background
  ctx.clearRect(0,0,rect.width,rect.height);

  // subtle starfield tile if loaded
  if (IMG.starfield){
    // draw tiled
    const img = IMG.starfield;
    const iw = img.width, ih = img.height;
    for (let x=0;x<rect.width;x+=iw){
      for (let y=0;y<rect.height;y+=ih){
        ctx.drawImage(img, x, y, iw, ih);
      }
    }
  } else {
    // fallback: simple gradient background already in CSS; draw faint stars
    ctx.fillStyle = 'rgba(255,255,255,0.015)';
    for (let i=0;i<120;i++){
      const sx = (i * 97) % rect.width;
      const sy = ((i*61) % rect.height);
      ctx.fillRect(sx, sy, 1, 1);
    }
  }

  // draw asteroids (texture if present else polygon)
  for (const a of asteroids){
    ctx.save();
    ctx.translate(a.x + a.w/2, a.y + a.h/2);
    ctx.rotate((a.rot || 0));
    if (IMG.asteroid){
      ctx.drawImage(IMG.asteroid, -a.w/2, -a.h/2, a.w, a.h);
    } else {
      ctx.fillStyle = '#9ea7b1';
      ctx.beginPath();
      ctx.moveTo(-a.w/2, -a.h/4);
      ctx.lineTo(-a.w/6, -a.h/2);
      ctx.lineTo(a.w/3, -a.h/3);
      ctx.lineTo(a.w/2, a.h/10);
      ctx.lineTo(a.w/6, a.h/2);
      ctx.lineTo(-a.w/3, a.h/3);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  // draw aliens
  for (const al of aliens){
    ctx.save();
    if (IMG.alien){
      ctx.drawImage(IMG.alien, al.x, al.y, al.w, al.h);
    } else {
      ctx.fillStyle = '#ff6b6b';
      ctx.beginPath();
      ctx.ellipse(al.x + al.w/2, al.y + al.h/2, al.w/2, al.h/2, 0, 0, Math.PI*2);
      ctx.fill();
    }
    ctx.restore();
  }

  // draw powerups
  for (const p of powerups){
    ctx.fillStyle = p.type === 'shield' ? '#6efcff' : '#fff06a';
    ctx.beginPath();
    ctx.arc(p.x, p.y, 10, 0, Math.PI*2);
    ctx.fill();
    ctx.fillStyle = '#012';
    ctx.font = '10px Inter, Arial';
    ctx.textAlign = 'center';
    ctx.fillText(p.type === 'shield' ? 'S' : 'Z', p.x, p.y + 3);
  }

  // draw particles
  for (const p of particles){
    ctx.fillStyle = p.color;
    ctx.globalAlpha = Math.max(0, 1 - (p.age / p.life));
    ctx.fillRect(p.x - p.size/2, p.y - p.size/2, p.size, p.size);
    ctx.globalAlpha = 1;
  }

  // draw bullets
  ctx.fillStyle = '#ffd166';
  for (const b of bullets) ctx.fillRect(b.x, b.y, b.w, b.h);

  // draw player ship (texture if loaded else triangle)
  if (IMG.ship){
    ctx.drawImage(IMG.ship, player.x, player.y, player.w, player.h);
    // flame: draw when boosting (small)
    if (keys['ArrowUp'] || keys['w'] || keys.touchBoost){
      if (IMG.flame){
        ctx.drawImage(IMG.flame, player.x + player.w/2 - 12, player.y + player.h - 2, 24, 28);
      } else {
        // fallback flame
        ctx.fillStyle = '#ff9f43';
        ctx.beginPath();
        ctx.moveTo(player.x + 10, player.y + player.h);
        ctx.lineTo(player.x + player.w/2, player.y + player.h + 16);
        ctx.lineTo(player.x + player.w - 10, player.y + player.h);
        ctx.closePath();
        ctx.fill();
      }
    }
  } else {
    // triangle ship
    ctx.save();
    ctx.translate(player.x + player.w/2, player.y + player.h/2);
    ctx.fillStyle = '#66c2ff';
    ctx.beginPath();
    ctx.moveTo(-player.w/2, player.h/2);
    ctx.lineTo(player.w/2, 0);
    ctx.lineTo(-player.w/2, -player.h/2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // flame
    if (keys['ArrowUp'] || keys['w'] || keys.touchBoost){
      ctx.fillStyle = '#ff9f43';
      ctx.beginPath();
      ctx.moveTo(player.x + 12, player.y + player.h);
      ctx.lineTo(player.x + player.w/2, player.y + player.h + 16);
      ctx.lineTo(player.x + player.w - 12, player.y + player.h);
      ctx.closePath();
      ctx.fill();
    }
  }
}

/* --------------------------
   GAME LOOP (rAF)
   -------------------------- */
let lastFrame = 0;
function loop(now){
  if (!lastFrame) lastFrame = now;
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  update(dt);
  draw();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

/* --------------------------
   AUTOSPWN interval (smoother)
   -------------------------- */
setInterval(() => {
  if (!running || paused) return;
  if (Math.random() < 0.9) spawnAsteroid();
  if (Math.random() < 0.1) spawnPowerup();
  if (score >= 50 && Math.random() < 0.08) spawnAlien();
}, 700);

/* --------------------------
   UI EVENTS
   -------------------------- */
btnStart?.addEventListener('click', () => { startGame(); });
btnTutorial?.addEventListener('click', () => {
  centerOverlay.classList.add('hidden');
  tutorialOverlay.classList.remove('hidden');
});
document.getElementById('btnTutorialClose')?.addEventListener('click', () => {
  tutorialOverlay.classList.add('hidden');
  startGame();
});
btnReplay?.addEventListener('click', () => { startGame(); });
btnMainMenu?.addEventListener('click', () => { gameOverOverlay.classList.add('hidden'); centerOverlay.classList.remove('hidden'); });

/* --------------------------
   INITIAL PLACEMENT
   -------------------------- */
setTimeout(() => {
  fitCanvas();
  const r = canvas.getBoundingClientRect();
  player.x = Math.floor(r.width/2 - player.w/2);
  player.y = r.height - player.h - 18;
  domScore.textContent = score;
  domLives.textContent = lives;
  domBest.textContent = best;
  domLevel.textContent = level;
}, 120);

/* --------------------------
   Helpful: expose startGame to dev console
   -------------------------- */
window.startSpaceShooter = startGame;
// TEST RAPIDE : ajouter 50 points avec la touche "P"
window.addEventListener('keydown', (e) => {
  if (e.key === 'p' || e.key === 'P') {
    score += 50;
    domScore.textContent = score;
    console.log('Score augmenté pour test :', score);
  }
});
/* --- AJOUT MOBILE --- */

// Bloquer le scroll tactile pendant le jeu
window.addEventListener('touchmove', e => e.preventDefault(), { passive: false });

// Afficher les boutons tactiles automatiquement sur mobile
const isMobile = /Mobi|Android/i.test(navigator.userAgent);
if (isMobile) {
  document.querySelector('.touch-controls').style.display = 'flex';
}

// Passer en plein écran au démarrage du jeu
const originalStartGame = startGame;
startGame = function(){
  if (canvas.requestFullscreen) {
    canvas.requestFullscreen().catch(()=>{});
  }
  originalStartGame();
};





