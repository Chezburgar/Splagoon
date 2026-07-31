// DOM heads-up display: timer, scores, ink tank, special, kill feed, minimap,
// scoreboard, results and the plaza UI.

import { TEAMS, WEAPONS, WEAPON_ORDER, SPECIALS, SUB } from '../shared/constants.js';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor(game) {
    this.game = game;
    this.el = {
      hud: $('hud'), scoreA: $('scoreA'), scoreB: $('scoreB'),
      clock: $('clock'), clockTime: $('clockTime'), clockLabel: $('clockLabel'),
      turfA: $('turfA'), turfB: $('turfB'),
      inkfill: $('inkfill'), inktank: $('inktank'),
      weaponName: $('weaponName'), subName: $('subName'),
      specialFill: $('specialFill'), specialName: $('specialName'), specialRing: $('specialRing'),
      killfeed: $('killfeed'), respawn: $('respawn'), respawnTimer: $('respawnTimer'),
      damage: $('damage'), announce: $('announce'),
      scoreboard: $('scoreboard'), sbA: $('sbA'), sbB: $('sbB'),
      results: $('results'), resBanner: $('resBanner'), resA: $('resA'), resB: $('resB'),
      resPctA: $('resPctA'), resPctB: $('resPctB'), resRows: $('resRows'),
      lobby: $('lobbyui'), playersOnline: $('playersOnline'),
      queuebox: $('queuebox'), qNum: $('qNum'), qTimer: $('qTimer'), qCancel: $('qCancel'),
      chatlog: $('chatlog'), chatinput: $('chatinput'),
      weaponCards: $('weaponCards'),
      title: $('title'), loading: $('loading'), connlost: $('connlost'),
      minimap: $('minimap'),
    };
    this.minimap = new MiniMap(this.el.minimap);
    this.lastSpecialReady = false;
    this.buildWeaponCards();
  }

  /* ------------------------------ lobby -------------------------------- */

  buildWeaponCards() {
    this.el.weaponCards.innerHTML = '';
    for (const id of WEAPON_ORDER) {
      const w = WEAPONS[id];
      const card = document.createElement('div');
      card.className = 'wcard';
      card.dataset.id = id;
      card.innerHTML = `
        <div class="wn">${w.name}</div>
        <div class="wd">${w.desc}</div>
        <div class="wstats">
          <span>RNG ${pips(w.stats.range)}</span>
          <span>DMG ${pips(w.stats.damage)}</span>
          <span>MOB ${pips(w.stats.mobility)}</span>
        </div>
        <div class="wd" style="margin-top:4px;opacity:.7">Special: ${SPECIALS[w.special].name}</div>`;
      card.onclick = () => this.game.selectWeapon(id);
      this.el.weaponCards.appendChild(card);
    }
  }

  setWeaponSelection(id) {
    for (const c of this.el.weaponCards.children) c.classList.toggle('sel', c.dataset.id === id);
    const w = WEAPONS[id];
    this.el.weaponName.textContent = w.name;
    this.el.subName.innerHTML = `${SUB.name} <b>Q</b>`;
    this.el.specialName.textContent = SPECIALS[w.special].name;
  }

  showTitle(show) { this.el.title.classList.toggle('hidden', !show); }
  showLoading(show) { this.el.loading.classList.toggle('hidden', !show); }
  showLobby(show) { this.el.lobby.classList.toggle('hidden', !show); }
  showHud(show) { this.el.hud.classList.toggle('hidden', !show); }
  showConnLost() { this.el.connlost.classList.remove('hidden'); }

  setOnline(n) {
    const suffix = this.offlineBadge ? ' · solo session' : '';
    this.el.playersOnline.textContent = `${n} inkling${n === 1 ? '' : 's'} in the plaza${suffix}`;
  }

  // Static hosting has no game server: the simulation runs in the page, so say
  // so rather than letting players wonder where everyone is.
  setOfflineBadge(on) {
    this.offlineBadge = on;
    let el = document.getElementById('offlineBadge');
    if (!on) { el?.remove(); return; }
    if (!el) {
      el = document.createElement('div');
      el.id = 'offlineBadge';
      el.innerHTML = 'OFFLINE MODE <span>server runs in your browser · you and bots</span>';
      document.getElementById('lobbyTop').appendChild(el);
    }
  }

  setQueue(n, seconds, queued) {
    this.el.queuebox.classList.toggle('hidden', !queued);
    this.el.qNum.textContent = n;
    this.el.qTimer.textContent = seconds;
  }

  chat(name, msg, team = 1) {
    const line = document.createElement('div');
    line.className = 'chatline';
    line.innerHTML = `<b style="color:${TEAMS[team]?.css || '#12cdf0'}">${escapeHtml(name)}</b> ${escapeHtml(msg)}`;
    this.el.chatlog.appendChild(line);
    while (this.el.chatlog.children.length > 7) this.el.chatlog.removeChild(this.el.chatlog.firstChild);
    setTimeout(() => line.remove(), 14000);
  }

  /* ------------------------------- match -------------------------------- */

  setTimer(seconds, phase) {
    const s = Math.max(0, Math.ceil(seconds));
    if (phase === 'countdown') {
      this.el.clockTime.textContent = s;
      this.el.clockLabel.textContent = 'GET READY';
    } else {
      const m = Math.floor(s / 60);
      this.el.clockTime.textContent = `${m}:${String(s % 60).padStart(2, '0')}`;
      this.el.clockLabel.textContent = 'TURF WAR';
    }
    this.el.clock.classList.toggle('urgent', phase === 'active' && s <= 30);
  }

  setScores(a, b) {
    this.el.scoreA.textContent = `${a.toFixed(1)}%`;
    this.el.scoreB.textContent = `${b.toFixed(1)}%`;
    // Each side grows inward from its own edge by the share of the stage it
    // actually owns; the gap in the middle is turf still up for grabs.
    this.el.turfA.style.width = `${Math.min(100, a)}%`;
    this.el.turfB.style.width = `${Math.min(100 - Math.min(100, a), b)}%`;
  }

  setInk(pct) {
    this.el.inkfill.style.height = `${Math.max(0, Math.min(100, pct))}%`;
    this.el.inktank.classList.toggle('low', pct < 25);
  }

  setInkColor(css) {
    this.el.inkfill.style.background = css;
  }

  setSpecial(pct, name) {
    const dash = 264;
    this.el.specialFill.style.strokeDashoffset = String(dash * (1 - Math.min(1, pct / 100)));
    if (name) this.el.specialName.textContent = name;
    const ready = pct >= 100;
    this.el.specialRing.classList.toggle('ready', ready);
    if (ready && !this.lastSpecialReady) this.game.audio.specialReady();
    this.lastSpecialReady = ready;
  }

  killLine(killerName, killerTeam, victimName, victimTeam, weapon) {
    const div = document.createElement('div');
    div.className = 'kf';
    div.style.borderLeftColor = TEAMS[killerTeam]?.css || '#fff';
    const w = WEAPONS[weapon]?.name || '';
    div.innerHTML = `<span class="n" style="color:${TEAMS[killerTeam]?.css}">${escapeHtml(killerName)}</span>
      <span style="opacity:.7"> ${w ? `· ${w} · ` : '→ '}</span>
      <span class="n" style="color:${TEAMS[victimTeam]?.css}">${escapeHtml(victimName)}</span>`;
    this.el.killfeed.appendChild(div);
    setTimeout(() => div.remove(), 6000);
    while (this.el.killfeed.children.length > 5) this.el.killfeed.removeChild(this.el.killfeed.firstChild);
  }

  announce(text, ms = 1600, color = '#fff') {
    const el = this.el.announce;
    el.textContent = text;
    el.style.color = color;
    el.classList.add('show');
    clearTimeout(this._annT);
    this._annT = setTimeout(() => el.classList.remove('show'), ms);
  }

  showRespawn(show, seconds = 0) {
    this.el.respawn.classList.toggle('hidden', !show);
    this.el.respawnTimer.textContent = Math.max(0, Math.ceil(seconds));
  }

  hitFlash() {
    this.el.damage.classList.add('hit');
    setTimeout(() => this.el.damage.classList.remove('hit'), 40);
  }

  setScoreboard(show, players, myId) {
    this.el.scoreboard.classList.toggle('hidden', !show);
    if (!show) return;
    for (const team of [0, 1]) {
      const ul = team === 0 ? this.el.sbA : this.el.sbB;
      ul.innerHTML = '';
      players.filter((p) => p.team === team)
        .sort((a, b) => (b.turf || 0) - (a.turf || 0))
        .forEach((p) => {
          const li = document.createElement('li');
          li.innerHTML = `<span>${p.id === myId ? '▶ ' : ''}${escapeHtml(p.name)}${p.bot ? ' <i style="opacity:.5">bot</i>' : ''}</span>
            <span class="stat">${WEAPONS[p.weapon]?.name || ''} · ${p.kills || 0}/${p.deaths || 0}</span>`;
          ul.appendChild(li);
        });
    }
  }

  showResults(res, myId) {
    this.el.results.classList.remove('hidden');
    const [a, b] = res.score;
    const myTeam = this.game.myTeam;
    const win = res.winner === myTeam;
    this.el.resBanner.textContent = res.winner === -1 ? 'DRAW!' : (win ? 'VICTORY!' : 'DEFEAT…');
    this.el.resBanner.style.color = res.winner === -1 ? '#fff' : TEAMS[res.winner].css;
    this.el.resPctA.textContent = `${a.toFixed(1)}%`;
    this.el.resPctB.textContent = `${b.toFixed(1)}%`;
    this.el.resA.style.width = '50%';
    this.el.resB.style.width = '50%';
    requestAnimationFrame(() => {
      const total = Math.max(0.001, a + b);
      const wa = (a / total) * 100;
      this.el.resA.style.width = `${wa}%`;
      this.el.resB.style.width = `${100 - wa}%`;
    });
    this.el.resRows.innerHTML = '';
    res.players.forEach((p, i) => {
      const tr = document.createElement('tr');
      tr.className = (p.team === 0 ? 'alpha' : 'bravo') + (p.id === myId ? ' me' : '');
      tr.innerHTML = `<td>${i + 1}</td><td>${escapeHtml(p.name)}${p.bot ? ' <i style="opacity:.5">bot</i>' : ''}</td>
        <td>${WEAPONS[p.weapon]?.name || ''}</td><td>${p.turf}</td><td>${p.kills}</td><td>${p.deaths}</td>`;
      this.el.resRows.appendChild(tr);
    });
  }

  hideResults() { this.el.results.classList.add('hidden'); }
}

/* -------------------------------- minimap ------------------------------- */

class MiniMap {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.world = null;
    this.acc = 0;
  }

  setWorld(world, flip) {
    this.world = world;
    this.flip = !!flip;
    const b = world.map.bounds;
    this.w = b.maxX - b.minX;
    this.d = b.maxZ - b.minZ;
    const cw = this.canvas.width, ch = this.canvas.height;
    this.scale = Math.min(cw / this.w, ch / this.d);
    this.ox = (cw - this.w * this.scale) / 2;
    this.oy = (ch - this.d * this.scale) / 2;
    this.img = this.ctx.createImageData(cw, ch);
    this.floors = world.surfaces
      .filter((s) => s.n.y > 0.5 && s.style !== 'bounds')
      .sort((x, y) => x.center.y - y.center.y);
    this.dirty = true;
  }

  toPixel(x, z) {
    const b = this.world.map.bounds;
    let px = (x - b.minX) * this.scale + this.ox;
    let py = (z - b.minZ) * this.scale + this.oy;
    if (this.flip) {
      px = this.canvas.width - px;
      py = this.canvas.height - py;
    }
    return [px, py];
  }

  redraw() {
    if (!this.world) return;
    const { data, width, height } = this.img;
    data.fill(0);
    const teamCols = TEAMS.map((t) => hexToRgb(t.ink));
    const bare = [86, 84, 104];

    for (const s of this.floors) {
      const cw = s.su / s.gw, cv = s.sv / s.gh;
      for (let j = 0; j < s.gh; j++) {
        for (let i = 0; i < s.gw; i++) {
          const val = s.grid[j * s.gw + i];
          const u = (i + 0.5) * cw, v = (j + 0.5) * cv;
          const wx = s.o.x + s.u.x * u + s.v.x * v;
          const wz = s.o.z + s.u.z * u + s.v.z * v;
          const [px, py] = this.toPixel(wx, wz);
          const c = val ? teamCols[val - 1] : bare;
          const x0 = Math.max(0, Math.floor(px)), y0 = Math.max(0, Math.floor(py));
          const x1 = Math.min(width - 1, Math.ceil(px + cw * this.scale) - 1);
          const y1 = Math.min(height - 1, Math.ceil(py + cv * this.scale) - 1);
          for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
              const o = (y * width + x) * 4;
              data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = val ? 235 : 150;
            }
          }
        }
      }
    }
    this.ctx.putImageData(this.img, 0, 0);
    this.baseline = this.ctx.getImageData(0, 0, width, height);
  }

  update(dt, players, myId) {
    if (!this.world) return;
    this.acc += dt;
    if (this.acc > 0.22 || !this.baseline) {
      this.acc = 0;
      this.redraw();
    } else if (this.baseline) {
      this.ctx.putImageData(this.baseline, 0, 0);
    }
    const g = this.ctx;
    for (const p of players) {
      const [px, py] = this.toPixel(p.pos.x, p.pos.z);
      g.beginPath();
      const me = p.id === myId;
      g.fillStyle = TEAMS[p.team]?.css || '#fff';
      g.strokeStyle = me ? '#fff' : 'rgba(0,0,0,0.6)';
      g.lineWidth = me ? 2.5 : 1.5;
      g.arc(px, py, me ? 5 : 3.6, 0, 6.2832);
      g.fill(); g.stroke();
      if (me) {
        const dir = this.flip ? p.yaw + Math.PI : p.yaw;
        g.beginPath();
        g.moveTo(px, py);
        g.lineTo(px + Math.sin(dir) * 11, py + Math.cos(dir) * 11);
        g.strokeStyle = '#fff'; g.lineWidth = 2.5; g.stroke();
      }
    }
  }
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function pips(n) {
  let s = '';
  for (let i = 0; i < 5; i++) s += `<span class="pip${i < n ? ' on' : ''}"></span>`;
  return s;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
