// Transport for the client. Normally a websocket to the Node server; on a
// static host (GitHub Pages) there is nothing to connect to, so the same
// protocol is spoken to an in-page copy of the server instead.

import { encode, decode } from '../shared/protocol.js';

export class Net {
  constructor() {
    this.ws = null;
    this.offlineServer = null;
    this.mode = null;            // 'ws' | 'offline'
    this.handlers = new Map();
    this.connected = false;
    this.rtt = 0;
    this.queue = [];
  }

  get offline() { return this.mode === 'offline'; }

  // `mode`: 'auto' (websocket, fall back to offline), 'ws' or 'offline'.
  async connect(mode = 'auto') {
    if (mode === 'offline') return this.connectOffline();
    try {
      await this.connectSocket();
    } catch (err) {
      if (mode === 'ws') throw err;
      console.info('[net] no game server reachable — starting offline mode');
      await this.connectOffline();
    }
  }

  connectSocket() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${location.host}/ws`;
    return new Promise((resolve, reject) => {
      let settled = false;
      let ws;
      try {
        ws = new WebSocket(url);
      } catch (err) { reject(err); return; }
      this.ws = ws;
      const fail = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(err || new Error('connection failed'));
      };
      const timeout = setTimeout(() => { try { ws.close(); } catch { /* ignore */ } fail(new Error('timeout')); }, 4000);

      ws.onopen = () => {
        settled = true;
        clearTimeout(timeout);
        this.mode = 'ws';
        this.connected = true;
        for (const m of this.queue) ws.send(m);
        this.queue.length = 0;
        this.pingTimer = setInterval(() => this.send({ t: 'ping', s: performance.now() }), 3000);
        resolve();
      };
      ws.onmessage = (ev) => this.receive(ev.data);
      ws.onclose = () => {
        if (!settled) { fail(); return; }
        this.connected = false;
        clearInterval(this.pingTimer);
        this.emit('disconnect', {});
      };
      ws.onerror = () => fail();
    });
  }

  async connectOffline() {
    const { OfflineServer } = await import('./offline.js');
    this.offlineServer = new OfflineServer();
    this.mode = 'offline';
    this.connected = true;
    this.offlineServer.attach((raw) => this.receive(raw));
    for (const m of this.queue) this.offlineServer.receive(m);
    this.queue.length = 0;
  }

  receive(raw) {
    const msg = decode(raw);
    if (!msg) return;
    if (msg.t === 'pong') { this.rtt = performance.now() - msg.s; return; }
    this.emit(msg.t, msg);
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type).push(fn);
  }

  emit(type, msg) {
    const list = this.handlers.get(type);
    if (!list) return;
    for (const fn of list) {
      try { fn(msg); } catch (err) { console.error('[net]', type, err); }
    }
  }

  send(obj) {
    const raw = encode(obj);
    if (this.mode === 'offline') { this.offlineServer.receive(raw); return; }
    if (this.ws && this.ws.readyState === 1) this.ws.send(raw);
    else if (this.ws && this.ws.readyState === 0) this.queue.push(raw);
  }
}
