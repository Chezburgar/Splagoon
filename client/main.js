// Splagoon client — scene orchestration, networking glue and the game loop.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { World, v3 } from '../shared/world.js';
import { getMap } from '../shared/mapdata.js';
import { C2S, S2C, PHASE, FLAG } from '../shared/protocol.js';
import { TEAMS, WEAPONS, PLAYER, SUB, MATCH, SPECIALS, INK } from '../shared/constants.js';

import { Stage } from './stage.js';
import { PaintSystem } from './paint.js';
import { Fx } from './fx.js';
import { Hud } from './hud.js';
import { Net } from './net.js';
import { audio } from './audio.js';
import { Inkling } from './models.js';
import { RemotePlayer } from './remote.js';
import { Input, LocalPlayer } from './localplayer.js';

class Game {
  constructor() {
    this.canvas = document.getElementById('view');
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas, antialias: true, powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    this.camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.1, 900);
    this.scene = new THREE.Scene();

    this.audio = audio;
    this.hud = new Hud(this);
    this.net = new Net();
    this.input = new Input(this.canvas);
    this.player = new LocalPlayer(this);

    this.remotes = new Map();
    this.roster = new Map();
    this.myId = -1;
    this.myTeam = 0;
    this.weapon = 'shooter';
    this.room = null;
    this.phase = PHASE.LOBBY;
    this.timeLeft = 0;
    this.scores = [0, 0];
    this.queued = false;
    this.showScoreboard = false;
    this.clock = new THREE.Clock();
    this.netAccum = 0;
    this.doorCooldown = 0;
    this.lastPhase = null;
    this.lastCountdownBeep = -1;

    // Adaptive quality: drops effects on weak GPUs so the game stays playable.
    this.quality = 3;               // 3 = bloom + shadows, 2 = no bloom, 1 = no shadows, 0 = low res
    this.autoQuality = true;
    this.frameAvg = 16;
    this.qualityTimer = 0;

    addEventListener('resize', () => this.onResize());
    this.setupUI();
    this.setupNet();
    this.loop = this.loop.bind(this);
  }

  /* ------------------------------- setup ------------------------------- */

  setupUI() {
    const nameInput = document.getElementById('nameInput');
    nameInput.value = localStorage.getItem('splagoon.name') || '';
    let team = Number(localStorage.getItem('splagoon.team') || 0);
    for (const btn of document.querySelectorAll('.teampick')) {
      btn.classList.toggle('selected', Number(btn.dataset.team) === team);
      btn.onclick = () => {
        team = Number(btn.dataset.team);
        for (const b of document.querySelectorAll('.teampick')) b.classList.toggle('selected', b === btn);
        audio.resume(); audio.ui();
      };
    }
    document.getElementById('playBtn').onclick = () => {
      const name = (nameInput.value || 'Inkling').slice(0, 14);
      localStorage.setItem('splagoon.name', name);
      localStorage.setItem('splagoon.team', String(team));
      audio.resume();
      audio.ui();
      this.hud.showTitle(false);
      this.hud.showLoading(true);
      this.connect(name, team);
    };
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('playBtn').click();
    });

    this.hud.el.qCancel.onclick = () => {
      this.net.send({ t: C2S.UNQUEUE });
      this.queued = false;
      this.hud.setQueue(0, 0, false);
      this.doorCooldown = 3;
      audio.ui();
    };

    const chat = this.hud.el.chatinput;
    chat.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const v = chat.value.trim();
        if (v) this.net.send({ t: C2S.CHAT, msg: v });
        chat.value = '';
        chat.blur();
        if (this.room === 'match') this.input.lock();
      } else if (e.key === 'Escape') { chat.value = ''; chat.blur(); }
    });

    this.canvas.addEventListener('click', () => {
      if (this.room && !this.input.locked) this.input.lock();
      audio.resume();
    });

    this.input.onKey = (code, down, ev) => {
      if (!down) {
        if (code === 'Tab') { this.showScoreboard = false; this.hud.setScoreboard(false); }
        return;
      }
      if (code === 'Tab') {
        ev.preventDefault();
        this.showScoreboard = true;
        this.hud.setScoreboard(true, [...this.roster.values()], this.myId);
      } else if (code === 'KeyT' || code === 'Slash') {
        ev.preventDefault();
        this.input.unlock();
        this.hud.el.chatinput.focus();
      } else if (code === 'Enter' && this.room === 'lobby') {
        this.toggleQueue();
      } else if (code === 'KeyM') {
        const muted = audio.toggleMute();
        this.hud.announce(muted ? 'AUDIO MUTED' : 'AUDIO ON', 900);
      } else if (code === 'Digit1' || code === 'Digit2' || code === 'Digit3' || code === 'Digit4') {
        if (this.room === 'lobby') {
          const ids = Object.keys(WEAPONS);
          this.selectWeapon(ids[Number(code.slice(-1)) - 1]);
        }
      }
    };
  }

  setupNet() {
    const net = this.net;
    net.on(S2C.WELCOME, (m) => { this.myId = m.id; this.hud.setOfflineBadge(!!m.offline); });
    net.on(S2C.ENTER, (m) => this.onEnter(m));
    net.on(S2C.STATE, (m) => this.onState(m));
    net.on(S2C.JOIN, (m) => this.onJoin(m.player));
    net.on(S2C.LEAVE, (m) => this.onLeave(m));
    net.on(S2C.SPLAT, (m) => this.onSplat(m));
    net.on(S2C.PROJ, (m) => this.onProjectile(m));
    net.on(S2C.FX, (m) => this.onFx(m));
    net.on(S2C.HIT, (m) => this.onHit(m));
    net.on(S2C.SPLATTED, (m) => this.onSplatted(m));
    net.on(S2C.RESPAWN, (m) => this.onRespawn(m));
    net.on(S2C.MATCH, (m) => this.onMatch(m));
    net.on(S2C.RESULTS, (m) => this.onResults(m));
    net.on(S2C.QUEUE, (m) => this.onQueue(m));
    net.on(S2C.CHAT, (m) => this.hud.chat(m.name, m.msg, this.roster.get(m.id)?.team ?? 1));
    net.on(S2C.SPECIAL, (m) => this.onSpecial(m));
    net.on('disconnect', () => this.hud.showConnLost());
  }

  async connect(name, team) {
    try {
      await this.net.connect(window.SPLAGOON_OFFLINE ? 'offline' : 'auto');
    } catch (err) {
      this.hud.showLoading(false);
      this.hud.showConnLost();
      return;
    }
    this.hud.setOfflineBadge(this.net.offline);
    this.myTeam = team;
    this.weapon = localStorage.getItem('splagoon.weapon') || 'shooter';
    this.net.send({ t: C2S.HELLO, name, team, weapon: this.weapon });
    this.hud.setWeaponSelection(this.weapon);
  }

  /* ------------------------------- rooms -------------------------------- */

  onEnter(msg) {
    this.room = msg.room;
    this.myId = msg.you ?? this.myId;
    if (typeof msg.team === 'number') this.myTeam = msg.team;
    this.phase = msg.phase;
    this.timeLeft = msg.timeLeft || 0;
    this.buildScene(msg.map);

    this.roster.clear();
    for (const p of msg.players || []) this.roster.set(p.id, p);
    const me = this.roster.get(this.myId);
    if (me) { this.myTeam = me.team; this.weapon = me.weapon || this.weapon; }

    // Local avatar.
    if (this.localModel) { this.scene.remove(this.localModel.root); this.localModel.dispose(); }
    this.localModel = new Inkling({
      team: this.myTeam, name: me?.name || 'You', weapon: this.weapon, isLocal: true,
    });
    this.scene.add(this.localModel.root);

    this.player.team = this.myTeam;
    this.player.weapon = this.weapon;
    this.player.specialCharge = 0;
    this.player.canControl = true;

    // Remote avatars.
    for (const rp of this.remotes.values()) rp.dispose();
    this.remotes.clear();
    for (const p of msg.players || []) {
      if (p.id === this.myId) continue;
      this.addRemote(p);
    }

    const spawn = this.pickSpawn();
    this.player.spawn(spawn, spawn.yaw);

    this.hud.showLoading(false);
    this.hud.showLobby(this.room === 'lobby');
    this.hud.showHud(this.room === 'match');
    this.hud.hideResults();
    this.hud.setWeaponSelection(this.weapon);
    this.hud.setInkColor(TEAMS[this.myTeam].css);
    this.hud.minimap.setWorld(this.world, this.myTeam === 1);
    this.hud.setOnline(this.roster.size);
    audio.setMode(this.room === 'match' ? 'battle' : 'lobby');
    this.queued = false;
    this.hud.setQueue(0, 0, false);
    this.doorCooldown = 2.5;

    if (this.room === 'match') {
      this.hud.announce(msg.stage || this.mapDef.name, 1800, '#ffe14d');
      setTimeout(() => {
        if (this.phase === PHASE.COUNTDOWN) this.hud.announce('READY?', 1200, TEAMS[this.myTeam].css);
      }, 1900);
      this.hud.setSpecial(0, SPECIALS[WEAPONS[this.weapon].special].name);
      audio.whistle();
    }
    if (!this.started) { this.started = true; this.clock.start(); this.loop(); }
    if (!this.input.locked) this.input.lock();
  }

  buildScene(mapId) {
    // Tear the old world down.
    if (this.paint) this.paint.dispose();
    if (this.scene) {
      this.scene.traverse((o) => {
        if (o.isMesh || o.isPoints || o.isSprite) {
          o.geometry?.dispose?.();
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) m?.dispose?.();
        }
      });
    }
    this.scene = new THREE.Scene();
    const mapDef = getMap(mapId);
    this.mapDef = mapDef;
    this.world = new World(mapDef);
    this.stage = new Stage(this.scene, this.world, mapDef);
    this.paint = new PaintSystem(this.renderer, this.world, this.scene);
    this.fx = new Fx(this.scene, this.world);
    this.localModel = null;

    // Post-processing chain.
    const composer = new EffectComposer(this.renderer);
    composer.setSize(innerWidth, innerHeight);
    composer.addPass(new RenderPass(this.scene, this.camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.34, 0.6, 0.95);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    this.composer = composer;
  }

  pickSpawn() {
    const spawns = this.mapDef.spawns;
    const group = spawns.find((s) => s.team === this.myTeam) || spawns[0];
    const idx = Math.floor(Math.random() * group.points.length);
    const p = group.points[idx];
    return { x: p.x, y: p.y + 0.2, z: p.z, yaw: p.yaw };
  }

  addRemote(info) {
    if (info.id === this.myId) return;
    if (this.remotes.has(info.id)) { this.remotes.get(info.id).setInfo(info); return; }
    const rp = new RemotePlayer(this.scene, info, this.world);
    this.remotes.set(info.id, rp);
  }

  /* ----------------------------- net events ----------------------------- */

  onJoin(info) {
    if (!info) return;
    this.roster.set(info.id, { ...(this.roster.get(info.id) || {}), ...info });
    if (info.id !== this.myId) this.addRemote(info);
    else if (info.weapon) this.weapon = info.weapon;
    this.hud.setOnline(this.roster.size);
  }

  onLeave(m) {
    const ids = m.ids || [m.id];
    for (const id of ids) {
      const rp = this.remotes.get(id);
      if (rp) { rp.dispose(); this.remotes.delete(id); }
      this.roster.delete(id);
    }
    this.hud.setOnline(this.roster.size);
  }

  onState(m) {
    if (m.ph) this.phase = m.ph;
    if (typeof m.tm === 'number') this.timeLeft = m.tm;
    if (m.sc) this.scores = m.sc;
    for (const s of m.ps) {
      if (s.i === this.myId) {
        this.player.hp = s.h;
        // Ink and special are server-authoritative; ease onto their values.
        this.player.ink += (s.k - this.player.ink) * 0.35;
        this.player.specialCharge = s.s;
        if ((s.f & FLAG.DEAD) && this.player.alive) this.player.alive = false;
        continue;
      }
      const rp = this.remotes.get(s.i);
      if (rp) rp.snapshot(s);
      else if (this.roster.has(s.i)) this.addRemote(this.roster.get(s.i));
    }
  }

  onSplat(m) {
    const pos = v3(m.p[0], m.p[1], m.p[2]);
    this.paint.splat(pos, m.r, m.tm, m.s);
    if (m.k === 'death' || m.k === 'blast' || m.k === 'strike') {
      // The big ones already spawn their own particles from FX events.
    } else if (Math.random() < 0.35) {
      this.fx.burst(pos, m.tm, { count: 3, speed: 2.2, size: 0.1, life: 0.35 });
    }
  }

  onProjectile(m) {
    const w = WEAPONS[m.w];
    this.fx.addProjectile({
      id: m.i, team: m.tm,
      pos: { x: m.p[0], y: m.p[1], z: m.p[2] },
      vel: { x: m.v[0], y: m.v[1], z: m.v[2] },
      gravity: m.g, life: m.l, radius: m.r,
      bomb: m.k === 'bomb',
    });
    const owner = this.remotes.get(m.o);
    if (owner) {
      owner.model.kick();
      const d = owner.pos.distanceTo(this.camera.position);
      if (d < 40 && Math.random() < 0.8) audio.shoot(w?.kind || 'shooter');
    }
  }

  onFx(m) {
    const p = v3(m.p[0], m.p[1], m.p[2]);
    switch (m.k) {
      case 'impact':
        if (m.o === this.myId) break; // already shown by local prediction
        this.fx.impact(p, m.team, m.n ? v3(m.n[0], m.n[1], m.n[2]) : null, false);
        break;
      case 'bomb':
        this.fx.explosion(p, m.team);
        audio.bomb();
        this.shake(0.6);
        break;
      case 'flick':
        this.fx.burst(p, m.team, { count: 10, speed: 5, size: 0.18, life: 0.5 });
        break;
      case 'inkstrikeHit':
        this.fx.explosion(p, m.team);
        this.fx.ring(p, v3(0, 1, 0), new THREE.Color(TEAMS[m.team].glow), { life: 1.1, from: 1, to: 16 });
        audio.bomb();
        this.shake(1.0);
        break;
      default: break;
    }
  }

  onHit(m) {
    if (m.id === this.myId) {
      this.player.hp = m.h;
      this.hud.hitFlash();
      audio.splat();
    } else if (m.by === this.myId) {
      audio.hitMarker();
    }
  }

  onSplatted(m) {
    const victim = this.roster.get(m.id);
    const killer = this.roster.get(m.by);
    const pos = v3(m.p[0], m.p[1], m.p[2]);
    this.fx.splatDeath(v3(pos.x, pos.y + 0.6, pos.z), killer ? killer.team : 1 - m.team);
    if (victim) victim.deaths = (victim.deaths || 0) + 1;
    if (killer) killer.kills = (killer.kills || 0) + 1;
    const cause = { enemyInk: 'Enemy Ink', pit: 'The Abyss', inkstorm: 'Ink Storm' };
    this.hud.killLine(killer?.name || cause[m.w] || 'The Abyss', killer?.team ?? (1 - m.team),
      victim?.name || '???', m.team, killer ? m.w : '');

    if (m.id === this.myId) {
      this.player.alive = false;
      this.player.canControl = false;
      this.player.squid = false;
      this.respawnAt = performance.now() / 1000 + PLAYER.respawnTime;
      this.hud.showRespawn(true, PLAYER.respawnTime);
      audio.death();
      this.shake(0.8);
    } else {
      const rp = this.remotes.get(m.id);
      if (rp) rp.alive = false;
      if (m.by === this.myId) {
        this.hud.announce('SPLAT!', 700, TEAMS[this.myTeam].css);
        audio.hitMarker();
      }
    }
  }

  onRespawn(m) {
    if (m.id === this.myId) {
      this.player.spawn(v3(m.p[0], m.p[1], m.p[2]), m.y ?? this.player.yaw);
      this.player.canControl = true;
      this.player.alive = true;
      this.hud.showRespawn(false);
      if (!m.correction) {
        audio.respawn();
        this.fx.ring(v3(m.p[0], m.p[1] + 0.1, m.p[2]), v3(0, 1, 0),
          new THREE.Color(TEAMS[this.myTeam].glow), { life: 0.8, from: 0.5, to: 6 });
      }
    } else {
      const rp = this.remotes.get(m.id);
      if (rp) {
        rp.alive = true;
        rp.pos.set(m.p[0], m.p[1], m.p[2]);
        rp.target.copy(rp.pos);
        this.fx.ring(v3(m.p[0], m.p[1] + 0.1, m.p[2]), v3(0, 1, 0),
          new THREE.Color(TEAMS[rp.team].glow), { life: 0.8, from: 0.5, to: 5 });
      }
    }
  }

  onMatch(m) {
    this.phase = m.phase;
    this.timeLeft = m.timeLeft;
    if (m.phase === PHASE.ACTIVE) {
      this.hud.announce('GO!', 1200, '#ffe14d');
      audio.whistle();
      audio.setMode('battle');
    }
  }

  onResults(m) {
    this.phase = PHASE.ENDED;
    this.results = m;
    this.scores = m.score;
    this.hud.showResults(m, this.myId);
    this.hud.showHud(false);
    this.player.canControl = false;
    this.input.unlock();
    audio.whistle();
    setTimeout(() => audio.fanfare(m.winner === this.myTeam), 700);
  }

  onQueue(m) {
    const queued = (m.ids || []).includes(this.myId);
    this.queued = queued;
    this.hud.setQueue(m.n, m.seconds, queued);
  }

  onSpecial(m) {
    const team = m.team;
    if (m.k === 'inkstrike' || m.k === 'inkstorm') {
      const t = v3(m.target[0], m.target[1], m.target[2]);
      this.fx.ring(t, v3(0, 1, 0), new THREE.Color(TEAMS[team].glow), { life: 1.4, from: 1, to: 12 });
      if (m.k === 'inkstrike') this.spawnStrikeMissile(t, team);
      audio.special();
    } else if (m.k === 'splashdown' || m.k === 'bubbler') {
      const rp = m.id === this.myId ? null : this.remotes.get(m.id);
      const p = rp ? v3(rp.pos.x, rp.pos.y, rp.pos.z) : v3(this.player.pos.x, this.player.pos.y, this.player.pos.z);
      this.fx.ring(p, v3(0, 1, 0), new THREE.Color(TEAMS[team].glow), { life: 0.9, from: 0.6, to: 8 });
      audio.special();
    }
    if (m.id === this.myId) this.hud.announce(SPECIALS[m.k].name.toUpperCase() + '!', 1100, TEAMS[team].css);
  }

  spawnStrikeMissile(target, team) {
    const geo = new THREE.ConeGeometry(0.35, 1.6, 10);
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(TEAMS[team].ink),
      emissive: new THREE.Color(TEAMS[team].ink), emissiveIntensity: 0.8,
    });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(target.x, target.y + 60, target.z);
    m.rotation.x = Math.PI;
    this.scene.add(m);
    const start = performance.now();
    const dur = SPECIALS.inkstrike.delay * 1000;
    const tick = () => {
      const k = (performance.now() - start) / dur;
      if (k >= 1) { this.scene.remove(m); geo.dispose(); mat.dispose(); return; }
      m.position.y = target.y + 60 * (1 - k * k);
      this.fx.spawnParticle(v3(m.position.x, m.position.y, m.position.z), v3(0, 1, 0),
        new THREE.Color(TEAMS[team].glow), 0.3, 0.5, 0);
      requestAnimationFrame(tick);
    };
    tick();
  }

  /* ---------------------------- local actions --------------------------- */

  onLocalFire(dir, charge) {
    const w = WEAPONS[this.weapon];
    const muzzle = this.player.muzzlePos();
    this.localModel?.kick();
    this.fx.burst(muzzle, this.myTeam, { count: 3, speed: 2.4, size: 0.1, life: 0.22 });

    const shots = [];
    if (w.kind === 'charger') {
      shots.push({
        dir, speed: w.projectileSpeed * (0.55 + 0.45 * charge),
        radius: w.projectileRadius * (0.7 + 0.8 * charge),
        life: w.projectileLife * (0.6 + 0.6 * charge), gravity: w.projectileGravity,
      });
    } else if (w.kind === 'roller') {
      const flat = { x: dir.x, y: dir.y * 0.35 + 0.12, z: dir.z };
      for (let i = 0; i < 7; i++) {
        const a = (i - 3) / 3 * 0.28;
        const d = {
          x: flat.x * Math.cos(a) - flat.z * Math.sin(a),
          y: flat.y,
          z: flat.x * Math.sin(a) + flat.z * Math.cos(a),
        };
        shots.push({ dir: d, speed: w.projectileSpeed * (0.8 + Math.random() * 0.4), radius: w.projectileRadius, life: w.projectileLife, gravity: w.projectileGravity });
      }
    } else {
      const pellets = w.pellets || 1;
      for (let i = 0; i < pellets; i++) {
        const spread = w.spread * (pellets > 1 ? 1 + i * 0.35 : 1);
        const d = {
          x: dir.x + (Math.random() - 0.5) * spread * 2,
          y: dir.y + (Math.random() - 0.5) * spread * 2,
          z: dir.z + (Math.random() - 0.5) * spread * 2,
        };
        const l = Math.hypot(d.x, d.y, d.z) || 1;
        shots.push({
          dir: { x: d.x / l, y: d.y / l, z: d.z / l },
          speed: w.projectileSpeed * (pellets > 1 ? 0.85 + Math.random() * 0.3 : 1),
          radius: w.projectileRadius, life: w.projectileLife, gravity: w.projectileGravity,
        });
      }
    }
    for (const s of shots) {
      this.fx.addProjectile({
        id: -1, team: this.myTeam, pos: muzzle,
        vel: { x: s.dir.x * s.speed, y: s.dir.y * s.speed, z: s.dir.z * s.speed },
        gravity: s.gravity, life: s.life, radius: s.radius, local: true,
        onHit: (p, n) => this.fx.impact(p, this.myTeam, n, false),
      });
    }
  }

  onSelfPit() {
    // Falling out of the stage: ask the server for a respawn by reporting death.
    this.player.canControl = false;
    this.hud.showRespawn(true, PLAYER.respawnTime);
  }

  selectWeapon(id) {
    if (!WEAPONS[id] || this.room !== 'lobby') return;
    this.weapon = id;
    this.player.weapon = id;
    localStorage.setItem('splagoon.weapon', id);
    this.net.send({ t: C2S.WEAPON, weapon: id });
    this.hud.setWeaponSelection(id);
    this.localModel?.setWeapon(id);
    audio.ui();
  }

  toggleQueue() {
    if (this.room !== 'lobby') return;
    this.queued = !this.queued;
    this.net.send({ t: this.queued ? C2S.QUEUE : C2S.UNQUEUE });
    audio.ui();
    if (this.queued) this.hud.announce('MATCHMAKING…', 1200, TEAMS[this.myTeam].css);
  }

  teamColorHex(team) { return TEAMS[team]?.ink || '#ffffff'; }

  shake(amount) {
    this.shakeAmount = Math.min(1.4, (this.shakeAmount || 0) + amount);
  }

  setChargeUI(charge) {
    const ch = document.getElementById('crosshair');
    if (ch) ch.style.transform = `translate(-50%,-50%) scale(${1 + charge * 0.55})`;
  }

  onResize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
    this.composer?.setSize(innerWidth, innerHeight);
    this.hud.minimap.dirty = true;
  }

  /* -------------------------------- loop -------------------------------- */

  loop() {
    requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, this.clock.getDelta());
    const now = performance.now() / 1000;

    this.player.update(dt, this.input, this.camera);

    // Local avatar follows the controller.
    if (this.localModel) {
      const p = this.player;
      this.localModel.root.position.set(p.pos.x, p.pos.y, p.pos.z);
      this.localModel.root.rotation.y = p.yaw;
      this.localModel.setSquid(p.squid);
      this.localModel.setVisible(p.alive);
      this.localModel.update(dt, {
        speed: Math.hypot(p.vel.x, p.vel.z),
        grounded: p.grounded,
        pitch: p.pitch,
        submerged: p.submerged,
      });
    }

    for (const rp of this.remotes.values()) rp.update(dt, this.fx);
    this.fx.update(dt);
    this.stage.update(now);

    // Camera shake.
    if (this.shakeAmount > 0.001) {
      const s = this.shakeAmount;
      this.camera.position.x += (Math.random() - 0.5) * s * 0.35;
      this.camera.position.y += (Math.random() - 0.5) * s * 0.35;
      this.camera.position.z += (Math.random() - 0.5) * s * 0.35;
      this.shakeAmount *= Math.pow(0.02, dt);
    }

    // Networking.
    this.netAccum += dt;
    if (this.netAccum > 1 / 30 && this.net.connected) {
      this.netAccum = 0;
      this.net.send(this.player.netState());
    }

    this.updateHud(dt, now);
    this.updateLobbyLogic(dt);

    this.updateQuality(dt);
    if (this.composer && this.quality >= 3) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  // Watch the frame time and shed work when the GPU cannot keep up.
  updateQuality(dt) {
    this.frameAvg += (dt * 1000 - this.frameAvg) * 0.05;
    if (!this.autoQuality) return;
    this.qualityTimer += dt;
    if (this.qualityTimer < 2) return;
    if (this.frameAvg > 34 && this.quality > 0) {
      this.qualityTimer = 0;
      this.setQuality(this.quality - 1);
    } else if (this.frameAvg < 13 && this.quality < 3) {
      this.qualityTimer = 0;
      this.setQuality(this.quality + 1);
    }
  }

  setQuality(q) {
    this.quality = q;
    this.renderer.shadowMap.enabled = q >= 2;
    this.renderer.setPixelRatio(q >= 1 ? Math.min(devicePixelRatio, 2) : 0.7);
    this.scene.traverse((o) => { if (o.isMesh && o.material) o.material.needsUpdate = true; });
    this.onResize();
  }

  updateHud(dt, now) {
    const p = this.player;
    this.hud.setInk((p.ink / INK.capacity) * 100);
    if (this.room === 'match') {
      if (this.phase === PHASE.ACTIVE || this.phase === PHASE.COUNTDOWN) {
        this.timeLeft = Math.max(0, this.timeLeft - dt);
      }
      this.hud.setTimer(this.timeLeft, this.phase);
      this.hud.setScores(this.scores[0], this.scores[1]);
      this.hud.setSpecial(p.specialCharge, SPECIALS[WEAPONS[this.weapon].special].name);

      if (this.phase === PHASE.COUNTDOWN) {
        const s = Math.ceil(this.timeLeft);
        if (s !== this.lastCountdownBeep && s > 0) {
          this.lastCountdownBeep = s;
          audio.countdown(s <= 1);
        }
      }
      if (!p.alive && this.respawnAt) {
        this.hud.showRespawn(true, this.respawnAt - now);
      }
      if (this.showScoreboard) this.hud.setScoreboard(true, [...this.roster.values()], this.myId);
    }
    const dots = [
      { id: this.myId, team: this.myTeam, pos: p.pos, yaw: p.yaw },
      ...[...this.remotes.values()].filter((r) => r.alive).map((r) => ({
        id: r.id, team: r.team, pos: { x: r.pos.x, z: r.pos.z }, yaw: r.yaw,
      })),
    ];
    if (this.room === 'match') this.hud.minimap.update(dt, dots, this.myId);
  }

  updateLobbyLogic(dt) {
    if (this.room !== 'lobby') return;
    this.doorCooldown = Math.max(0, this.doorCooldown - dt);
    const door = this.mapDef.battleDoor;
    if (!door || this.queued || this.doorCooldown > 0) return;
    const d = Math.hypot(this.player.pos.x - door.x, this.player.pos.z - door.z);
    if (d < door.radius) {
      this.queued = true;
      this.net.send({ t: C2S.QUEUE });
      this.hud.announce('ENTERING DECA TOWER', 1400, TEAMS[this.myTeam].css);
      audio.ui();
    }
  }
}

const game = new Game();
window.__game = game;
game.hud.showLoading(false);
game.hud.showTitle(true);
