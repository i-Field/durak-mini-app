// Cloudflare Worker: Telegram-бот + PvP-комнаты + лига месяца (рейтинг и автоначисление монет)
import { DurableObject } from 'cloudflare:workers';

const PRIZES = [10000, 5000, 2500]; // монеты за 1-е, 2-е, 3-е место
const ACTIVE = 500;                 // награда активным игрокам
const ACTMIN = 20;                  // сколько партий за месяц считается активностью
const BOTCAP = 10;                  // партий с ботом в день, идущих в активность
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, 'content-type': 'application/json' } });
const stats = env => env.STATS.get(env.STATS.idFromName('main'));

export default {
  async fetch(req, env) {
    const u = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (u.pathname === '/ws') {
      const r = (u.searchParams.get('room') || '').slice(0, 16).replace(/[^\w-]/g, '');
      if (!r) return new Response('no room', { status: 400 });
      return env.ROOM.get(env.ROOM.idFromName(r)).fetch(req);
    }
    if (u.pathname === '/api/top') return J(await stats(env).top());
    if (u.pathname === '/api/me' || u.pathname === '/api/bot') {
      const b = await req.json().catch(() => ({}));
      const usr = await verify(b.init, env);
      if (!usr) return J({ error: 'auth' }, 401);
      if (u.pathname === '/api/bot') { await stats(env).bot(usr.id, usr.name); return J({ ok: 1 }); }
      return J(await stats(env).me(usr.id, usr.name));
    }
    if (u.pathname === '/admin/payout' && u.searchParams.get('key') === env.WEBHOOK_SECRET)
      return J(await payout(env, u.searchParams.get('m')));
    if (req.method === 'POST' && u.pathname === '/webhook/' + env.WEBHOOK_SECRET) {
      await bot(await req.json(), env);
      return new Response('ok');
    }
    return new Response('Durak Empire server');
  },
  // 1-го числа каждого месяца (cron в wrangler.toml): награждаем итоги прошлого месяца
  async scheduled(_ev, env, ctx) { ctx.waitUntil(payout(env)); },
};

async function payout(env, m) {
  if (!m) { const n = new Date(); m = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() - 1, 1)).toISOString().slice(0, 7); }
  const list = await stats(env).payout(m);
  for (const a of list)
    await tg(env, 'sendMessage', { chat_id: a.id, text: `🏆 Durak Empire: ${a.note}!\nВам начислено ${a.coins} 🪙. Откройте игру, чтобы получить награду.` }).catch(() => {});
  return { month: m, awarded: list.length };
}

async function tg(env, method, body) {
  return fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
}

async function bot(up, env) {
  const m = up.message;
  if (!m || !m.text || !m.text.startsWith('/start')) return;
  const room = (m.text.split(' ')[1] || '').replace(/[^\w-]/g, '');
  const url = env.WEBAPP_URL + (room ? '?room=' + room : '');
  await tg(env, 'sendMessage', {
    chat_id: m.chat.id,
    text: room ? '🃏 Вас пригласили за стол. Присоединяйтесь!' : '👑 Durak Empire — подкидной дурак',
    reply_markup: { inline_keyboard: [[{ text: '🃏 Играть', web_app: { url } }]] },
  });
}

// ---- проверка подписи Telegram (initData), чтобы нельзя было подделать игрока ----
async function hmac(key, msg) {
  const k = await crypto.subtle.importKey('raw', typeof key === 'string' ? new TextEncoder().encode(key) : key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg)));
}
async function verify(init, env) {
  try {
    const p = new URLSearchParams(init || '');
    const hash = p.get('hash'); if (!hash) return null;
    p.delete('hash');
    const str = [...p.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1).map(([k, v]) => k + '=' + v).join('\n');
    const sig = [...await hmac(await hmac('WebAppData', env.BOT_TOKEN), str)].map(x => x.toString(16).padStart(2, '0')).join('');
    if (sig !== hash) return null;
    if (Date.now() / 1000 - Number(p.get('auth_date')) > 172800) return null;
    const u = JSON.parse(p.get('user'));
    const name = ([u.first_name, u.last_name && u.last_name[0] + '.'].filter(Boolean).join(' ') || u.username || 'Игрок').replace(/[<>&"'`]/g, '').slice(0, 20);
    return { id: String(u.id), name };
  } catch (_) { return null; }
}

// ---- лига месяца: статистика и награды (SQLite внутри Durable Object) ----
export class Stats extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS st(m TEXT,id TEXT,name TEXT,w INT DEFAULT 0,g INT DEFAULT 0,d TEXT DEFAULT '',bd INT DEFAULT 0,PRIMARY KEY(m,id))`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS pend(id TEXT PRIMARY KEY,coins INT DEFAULT 0,note TEXT DEFAULT '')`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS paid(m TEXT PRIMARY KEY)`);
  }
  mk() { return new Date().toISOString().slice(0, 7); }
  touch(id, name) {
    const m = this.mk();
    this.sql.exec('INSERT INTO st(m,id,name) VALUES(?,?,?) ON CONFLICT(m,id) DO UPDATE SET name=excluded.name', m, id, name);
    return m;
  }
  pvp(a, an, b, bn, win) { // win: 0 — победил a, 1 — победил b, -1 — ничья
    const m = this.touch(a, an); this.touch(b, bn);
    this.sql.exec('UPDATE st SET g=g+1,w=w+? WHERE m=? AND id=?', win === 0 ? 1 : 0, m, a);
    this.sql.exec('UPDATE st SET g=g+1,w=w+? WHERE m=? AND id=?', win === 1 ? 1 : 0, m, b);
  }
  bot(id, name) { // партии с ботом: только «активность», не более BOTCAP в день
    const m = this.touch(id, name), d = new Date().toISOString().slice(0, 10);
    const r = this.sql.exec('SELECT d,bd FROM st WHERE m=? AND id=?', m, id).toArray()[0];
    const bd = r.d === d ? r.bd : 0;
    if (bd >= BOTCAP) return;
    this.sql.exec('UPDATE st SET g=g+1,d=?,bd=? WHERE m=? AND id=?', d, bd + 1, m, id);
  }
  me(id, name) { // статистика игрока + забрать накопленную награду (атомарно)
    const m = this.touch(id, name);
    const r = this.sql.exec('SELECT w,g FROM st WHERE m=? AND id=?', m, id).toArray()[0];
    const rank = this.sql.exec('SELECT COUNT(*) AS c FROM st WHERE m=? AND w>?', m, r.w).toArray()[0].c + 1;
    const p = this.sql.exec('SELECT coins,note FROM pend WHERE id=?', id).toArray()[0];
    if (p) this.sql.exec('DELETE FROM pend WHERE id=?', id);
    return { m, w: r.w, g: r.g, rank, award: p ? p.coins : 0, note: p ? p.note : '' };
  }
  top() {
    return this.sql.exec('SELECT name,w,g FROM st WHERE m=? AND w>0 ORDER BY w DESC,g ASC LIMIT 10', this.mk()).toArray();
  }
  payout(m) { // идемпотентно: за один месяц награждаем один раз
    if (this.sql.exec('SELECT 1 FROM paid WHERE m=?', m).toArray().length) return [];
    const out = [];
    const top = this.sql.exec('SELECT id FROM st WHERE m=? AND w>0 ORDER BY w DESC,g ASC LIMIT 3', m).toArray();
    const skip = new Set(top.map(r => r.id));
    top.forEach((r, i) => out.push({ id: r.id, coins: PRIZES[i], note: ['🥇 1 место', '🥈 2 место', '🥉 3 место'][i] + ' в лиге месяца' }));
    this.sql.exec('SELECT id FROM st WHERE m=? AND g>=?', m, ACTMIN).toArray()
      .forEach(r => { if (!skip.has(r.id)) out.push({ id: r.id, coins: ACTIVE, note: 'Награда за активность' }); });
    out.forEach(a => this.sql.exec(`INSERT INTO pend(id,coins,note) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET coins=coins+excluded.coins,note=note||' · '||excluded.note`, a.id, a.coins, a.note));
    this.sql.exec('INSERT INTO paid(m) VALUES(?)', m);
    return out;
  }
}

// ---- PvP-комната (2 игрока, сервер хранит всю партию) ----
const beats = (g, d, a) => d.s === a.s ? d.r > a.r : (d.s === g.tr && a.s !== g.tr);

export class Room {
  constructor(state, env) { this.env = env; this.seats = [null, null]; this.names = ['', '']; this.uid = [null, null]; this.g = null; this.re = [0, 0]; }

  async fetch(req) {
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('ws only', { status: 426 });
    const q = new URL(req.url).searchParams;
    const usr = await verify(q.get('init'), this.env);
    const name = usr ? usr.name : (q.get('name') || 'Игрок').replace(/[<>&"'`]/g, '').slice(0, 20);
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    const seat = this.seats.findIndex(x => !x);
    if (seat < 0) { server.send(JSON.stringify({ t: 'full' })); server.close(); return new Response(null, { status: 101, webSocket: client }); }
    this.seats[seat] = server; this.names[seat] = name; this.uid[seat] = usr ? usr.id : null;
    server.addEventListener('message', e => { try { this.msg(seat, JSON.parse(e.data)); } catch (_) {} });
    server.addEventListener('close', () => {
      if (this.seats[seat] !== server) return;
      this.seats[seat] = null;
      if (this.g && !this.g.over) this.end(1 - seat);
    });
    if (this.seats[0] && this.seats[1] && (!this.g || this.g.over)) this.deal();
    else server.send(JSON.stringify({ t: 'wait' }));
    return new Response(null, { status: 101, webSocket: client });
  }

  deal() {
    const d = [];
    for (let s = 0; s < 4; s++) for (let r = 6; r <= 14; r++) d.push({ s, r });
    for (let i = d.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [d[i], d[j]] = [d[j], d[i]]; }
    const g = this.g = { deck: d, h: [[], []], table: [], att: 0, taking: false, cap: 6, over: false, tr: d[0].s, rd: 0 };
    this.re = [0, 0];
    this.fill(0); this.fill(1);
    const lt = h => Math.min(99, ...h.filter(c => c.s === g.tr).map(c => c.r));
    const a = lt(g.h[0]), b = lt(g.h[1]);
    g.att = a < b ? 0 : b < a ? 1 : (Math.random() < .5 ? 0 : 1);
    g.cap = Math.min(6, g.h[1 - g.att].length);
    this.push();
  }

  fill(w) { const g = this.g; while (g.h[w].length < 6 && g.deck.length) g.h[w].push(g.deck.pop()); }

  msg(seat, m) {
    const g = this.g;
    if (m.t === 'again') {
      if (g && g.over) { this.re[seat] = 1; if (this.re[0] && this.re[1] && this.seats[0] && this.seats[1]) this.deal(); }
      return;
    }
    if (!g || g.over) return;
    const def = 1 - g.att, un = g.table.filter(x => !x.d);
    if (m.t === 'play') {
      const c = g.h[seat][m.i]; if (!c) return;
      if (seat === g.att) {
        if (!(g.taking || un.length === 0)) return;
        const rk = new Set(g.table.flatMap(x => x.d ? [x.a.r, x.d.r] : [x.a.r]));
        if (g.table.length && (!rk.has(c.r) || g.table.length >= g.cap)) return;
        g.h[seat].splice(m.i, 1); g.table.push({ a: c });
      } else {
        if (g.taking) return;
        const u = un.find(x => beats(g, c, x.a)); if (!u) return;
        g.h[seat].splice(m.i, 1); u.d = c;
      }
      const left = g.table.filter(x => !x.d).length;
      if (!left && g.table.length && (!g.h[def].length || !g.h[g.att].length)) return this.round(false);
      this.push();
    } else if (m.t === 'act') {
      if (seat === def && un.length && !g.taking) { g.taking = true; this.push(); }
      else if (seat === g.att) {
        if (g.taking) this.round(true);
        else if (g.table.length && !un.length) this.round(false);
      }
    }
  }

  round(taken) {
    const g = this.g, w = 1 - g.att;
    g.rd++;
    if (taken) g.h[w].push(...g.table.flatMap(x => x.d ? [x.a, x.d] : [x.a]));
    g.table = []; this.fill(g.att); this.fill(w);
    if (!g.deck.length) {
      const e0 = !g.h[0].length, e1 = !g.h[1].length;
      if (e0 && e1) return this.end(-1);
      if (e0) return this.end(0);
      if (e1) return this.end(1);
    }
    if (!taken) g.att = w;
    g.taking = false; g.cap = Math.min(6, g.h[1 - g.att].length);
    this.push();
  }

  end(winner) {
    const g = this.g;
    g.over = true; this.push();
    this.seats.forEach((s, i) => s && s.send(JSON.stringify({ t: 'over', res: winner < 0 ? 'draw' : winner === i ? 'win' : 'lose' })));
    const [a, b] = this.uid;
    // в лигу идут только настоящие партии (не меньше 3 раундов) между разными игроками
    if (a && b && a !== b && g.rd >= 3)
      stats(this.env).pvp(a, this.names[0], b, this.names[1], winner).catch(() => {});
  }

  push() {
    const g = this.g;
    this.seats.forEach((s, i) => s && s.send(JSON.stringify({
      t: 'state', hand: g.h[i], opp: g.h[1 - i].length, table: g.table, att: g.att === i ? 'p' : 'b',
      taking: g.taking, tr: g.tr, deck: g.deck.length, trumpCard: g.deck[0] || null,
    })));
  }
}
