// Thin websocket wrapper with a tiny event bus and RTT tracking.
import { encode, decode } from '../shared/protocol.js';

export class Net {
  constructor() {
    this.ws = null;
    this.handlers = new Map();
    this.connected = false;
    this.rtt = 0;
    this.queue = [];
  }

  connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${location.host}/ws`;
    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(url);
      this.ws = ws;
      ws.onopen = () => {
        this.connected = true;
        settled = true;
        for (const m of this.queue) ws.send(m);
        this.queue.length = 0;
        this.pingTimer = setInterval(() => this.send({ t: 'ping', s: performance.now() }), 3000);
        resolve();
      };
      ws.onmessage = (ev) => {
        const msg = decode(ev.data);
        if (!msg) return;
        if (msg.t === 'pong') { this.rtt = performance.now() - msg.s; return; }
        this.emit(msg.t, msg);
      };
      ws.onclose = () => {
        this.connected = false;
        clearInterval(this.pingTimer);
        this.emit('disconnect', {});
        if (!settled) reject(new Error('connection failed'));
      };
      ws.onerror = () => { if (!settled) { settled = true; reject(new Error('connection error')); } };
    });
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
    if (this.ws && this.ws.readyState === 1) this.ws.send(raw);
    else if (this.ws && this.ws.readyState === 0) this.queue.push(raw);
  }
}
