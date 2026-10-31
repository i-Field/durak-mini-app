// Durak Empire — Cloudflare Worker: Telegram-бот, онлайн-столы (2–4 игрока), лобби, лига месяца, Stars
import { DurableObject } from 'cloudflare:workers';

const VERSION = '2026-10-28-v4';
const APP = env => env.WEBAPP_URL || 'https://i-field.github.io/durak-mini-app/';
const PRIZES = [10000, 5000, 2500];             // монеты за 1–3 место лиги
const ACTIVE = 500, ACTMIN = 20, BOTCAP = 10;   // награда активным, порог партий, лимит партий с ботом в день
const PACKS = [[2000, 35], [6000, 90], [15000, 200]]; // [монеты, Stars]
const DONATE = [10, 50, 100, 500];              // суммы доната в Stars (бонус: 10 монет за 1 Star)
const TURN_MS = 40000;                          // таймер хода онлайн
const BOTNAMES = ['Рыцарь Сердец', 'Король Бубен', 'Варвар', 'Маска', 'Шут Изумруд', 'Шут Фиолет', 'Шут-Маска'];
const EMO = ['😂', '😡', '👍', '😱', '🔥', '🤝', '😎', '😭'];
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, 'content-type': 'application/json' } });
const stub = (ns, env) => env[ns].get(env[ns].idFromName('main'));

// ===== DURAK ENGINE: одинаковый код на сервере и в игре (2–4 игрока) =====
const RK=[6,7,8,9,10,11,12,13,14];
const beats=(g,d,a)=>d.s===a.s?d.r>a.r:(d.s===g.tr&&a.s!==g.tr);
const undef=g=>g.table.filter(x=>!x.d);
const ranksOn=g=>{const s=new Set();g.table.forEach(x=>{s.add(x.a.r);if(x.d)s.add(x.d.r)});return s};
const nextAlive=(g,p)=>{let q=(p+1)%g.n;while(g.out.includes(q))q=(q+1)%g.n;return q};
function gNew(n){
 const d=[];for(let s=0;s<4;s++)for(const r of RK)d.push({s,r});
 for(let i=d.length-1;i>0;i--){const j=Math.random()*(i+1)|0;[d[i],d[j]]=[d[j],d[i]]}
 const g={n,deck:d,h:Array.from({length:n},()=>[]),table:[],tr:d[0].s,att:0,def:1,taking:false,cap:6,over:false,out:[],pass:[],rd:0,disc:0,durak:-2,win:-1};
 for(let k=0;k<6;k++)for(let p=0;p<n;p++)g.h[p].push(g.deck.pop());
 let best=99,who=Math.random()*n|0;
 for(let p=0;p<n;p++)for(const c of g.h[p])if(c.s===g.tr&&c.r<best){best=c.r;who=p}
 g.att=who;gStart(g);return g}
function gStart(g){g.table=[];g.taking=false;g.pass=[];g.def=nextAlive(g,g.att);g.cap=Math.min(6,g.h[g.def].length)}
function canThrow(g,p){return p!==g.def&&!g.out.includes(p)&&g.table.length>0&&g.table.length<g.cap&&g.h[p].some(c=>ranksOn(g).has(c.r))}
function pending(g){const r=[];for(let p=0;p<g.n;p++)if(canThrow(g,p)&&!g.pass.includes(p))r.push(p);return r}
function gActors(g){if(g.over)return[];if(!g.table.length)return[g.att];if(undef(g).length&&!g.taking)return[g.def];return pending(g)}
function gAuto(g){if(g.over||!g.table.length)return;if(undef(g).length&&!g.taking)return;if(!pending(g).length)gEnd(g,g.taking)}
function gPlay(g,p,i){
 if(g.over||g.out.includes(p))return false;const c=g.h[p][i];if(!c)return false;
 if(p===g.def){if(g.taking)return false;const u=undef(g).find(x=>beats(g,c,x.a));if(!u)return false;g.h[p].splice(i,1);u.d=c;g.pass=[]}
 else{if(!g.table.length){if(p!==g.att)return false}else if(!ranksOn(g).has(c.r))return false;
  if(g.table.length>=g.cap)return false;g.h[p].splice(i,1);g.table.push({a:c});g.pass=[]}
 gAuto(g);return true}
function gAct(g,p){
 if(g.over||g.out.includes(p))return false;const un=undef(g).length;
 if(p===g.def){if(un&&!g.taking){g.taking=true;g.pass=[];gAuto(g);return true}return false}
 if(g.table.length&&(g.taking||!un)&&!g.pass.includes(p)&&canThrow(g,p)){g.pass.push(p);gAuto(g);return true}
 return false}
function gEnd(g,taken){
 const d=g.def;g.rd++;const all=g.table.flatMap(x=>x.d?[x.a,x.d]:[x.a]);
 if(taken)g.h[d].push(...all);else g.disc+=all.length;
 g.table=[];const order=[];for(let k=0;k<g.n;k++){const p=(g.att+k)%g.n;if(p!==d)order.push(p)}order.push(d);
 for(const p of order)while(g.h[p].length<6&&g.deck.length)g.h[p].push(g.deck.pop());
 if(!g.deck.length)for(let p=0;p<g.n;p++)if(!g.h[p].length&&!g.out.includes(p))g.out.push(p);
 const act=[];for(let p=0;p<g.n;p++)if(!g.out.includes(p))act.push(p);
 if(act.length<=1){g.over=true;g.durak=act.length?act[0]:-1;g.win=g.out.length?g.out[0]:-1;g.taking=false;g.pass=[];return}
 let na=taken?(d+1)%g.n:d;while(g.out.includes(na))na=(na+1)%g.n;
 g.att=na;gStart(g)}
const gRes=(g,p)=>g.durak===-1?'draw':p===g.durak?'lose':p===g.win?'win':'safe';
function gView(g,p){return{n:g.n,me:p,hand:g.h[p],cnt:g.h.map(h=>h.length),table:g.table,tr:g.tr,deck:g.deck.length,trumpCard:g.deck[0]||null,att:g.att,def:g.def,taking:g.taking,out:g.out,over:g.over,durak:g.durak,cap:g.cap,act:gActors(g)}}
function aiMove(g,p,lvl){
 const h=g.h[p],un=undef(g),T=g.tr,val=c=>c.r+(c.s===T?20:0),R=Math.random,ix=c=>h.indexOf(c);
 if(p===g.def){
  if(g.taking||!un.length)return null;const u=un[0];
  const o=h.filter(c=>beats(g,c,u.a)).sort((a,b)=>val(a)-val(b));
  if(!o.length)return{t:'act'};
  if(lvl==='easy')return R()<.3?{t:'act'}:{t:'play',i:ix(o[R()*o.length|0])};
  const c=o[0];
  if(lvl==='hard'&&c.s===T&&u.a.s!==T&&u.a.r<=10&&g.deck.length>5&&h.length>=4&&un.length===1&&g.table.length<=2)return{t:'act'};
  return{t:'play',i:ix(c)}}
 if(!g.table.length){
  if(lvl==='easy')return{t:'play',i:R()*h.length|0};
  const cnt=r=>h.filter(c=>c.r===r).length,sc=c=>val(c)-(lvl==='hard'?(cnt(c.r)-1)*3:0);
  return{t:'play',i:ix(h.slice().sort((a,b)=>sc(a)-sc(b))[0])}}
 const rk=ranksOn(g),ok=h.filter(c=>rk.has(c.r));
 if(!ok.length||g.table.length>=g.cap)return{t:'act'};
 if(lvl==='easy')return R()<.5?{t:'play',i:ix(ok[R()*ok.length|0])}:{t:'act'};
 const nt=ok.filter(c=>c.s!==T).sort((a,b)=>val(a)-val(b));
 if(nt.length)return{t:'play',i:ix(nt[0])};
 if(!g.deck.length)return{t:'play',i:ix(ok.sort((a,b)=>val(a)-val(b))[0])};
 return{t:'act'}}
function aiTurn(g,bots){
 if(g.over)return false;
 for(const p of gActors(g)){const l=bots[p];if(!l)continue;const m=aiMove(g,p,l);if(!m)continue;
  let ok=m.t==='play'?gPlay(g,p,m.i):gAct(g,p);if(!ok)ok=gAct(g,p);if(!ok)continue;return true}
 return false}


export default {
  async fetch(req, env) {
    const u = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (u.pathname === '/ws') {
      const r = (u.searchParams.get('room') || '').slice(0, 12).replace(/[^\w-]/g, '').toUpperCase();
      if (!r) return new Response('no room', { status: 400 });
      return env.ROOM.get(env.ROOM.idFromName(r)).fetch(req);
    }
    if (u.pathname === '/health') {
      const out = { version: VERSION, BOT_TOKEN: !!env.BOT_TOKEN, WEBHOOK_SECRET: !!env.WEBHOOK_SECRET, ADMIN_ID: !!env.ADMIN_ID, WEBAPP_URL: APP(env), ROOM: !!env.ROOM, STATS: !!env.STATS, LOBBY: !!env.LOBBY };
      if (env.BOT_TOKEN) {
        const me = await (await tg(env, 'getMe', {})).json().catch(() => ({}));
        out.bot = me.ok ? '@' + me.result.username : 'ОШИБКА: ' + (me.description || 'нет ответа');
        const wi = await (await tg(env, 'getWebhookInfo', {})).json().catch(() => ({}));
        out.webhook = wi.ok ? { set: !!wi.result.url, pending: wi.result.pending_update_count, error: wi.result.last_error_message || null } : 'ошибка';
      }
      return J(out);
    }
    if (u.pathname === '/api/lobby') { // онлайн и открытые столы
      const id = (u.searchParams.get('u') || '').replace(/[^\w-]/g, '').slice(0, 24);
      const lb = stub('LOBBY', env);
      if (id) await lb.beat(id);
      return J(await lb.list());
    }
    if (u.pathname === '/api/top') return J(await stub('STATS', env).top());
    if (['/api/me', '/api/bot', '/api/invoice'].includes(u.pathname)) {
      const b = await req.json().catch(() => ({}));
      const usr = await verify(b.init, env);
      if (!usr) return J({ error: 'auth' }, 401);
      const st = stub('STATS', env);
      if (u.pathname === '/api/bot') { await st.bot(usr.id, usr.name); return J({ ok: 1 }); }
      if (u.pathname === '/api/me') return J(await st.me(usr.id, usr.name));
      let title, desc, payload, amount, label;
      if (b.donate) {
        const n = Number(b.donate); if (!DONATE.includes(n)) return J({ error: 'amount' }, 400);
        title = 'Поддержка проекта'; desc = 'Спасибо за поддержку Durak Empire!'; payload = { d: n, u: usr.id }; amount = n; label = 'Поддержка';
      } else {
        const k = Number(b.pack), pk = PACKS[k]; if (!pk) return J({ error: 'pack' }, 400);
        title = 'Монеты Империи'; desc = pk[0] + ' монет для Durak Empire'; payload = { k, u: usr.id }; amount = pk[1]; label = pk[0] + ' монет';
      }
      const r = await tg(env, 'createInvoiceLink', { title, description: desc, payload: JSON.stringify(payload), provider_token: '', currency: 'XTR', prices: [{ label, amount }] });
      const j = await r.json();
      return j.ok ? J({ link: j.result }) : J({ error: j.description }, 502);
    }
    if (u.pathname === '/admin/setup' && u.searchParams.get('key') === env.WEBHOOK_SECRET) {
      if (!env.BOT_TOKEN) return J({ error: 'Секрет BOT_TOKEN не задан в Cloudflare' });
      const a = await (await tg(env, 'setWebhook', { url: u.origin + '/webhook/' + env.WEBHOOK_SECRET })).json();
      const b = await (await tg(env, 'setChatMenuButton', { menu_button: { type: 'web_app', text: 'Играть', web_app: { url: APP(env) } } })).json();
      const c = await (await tg(env, 'setMyCommands', { commands: [{ command: 'start', description: 'Играть / Play' }, { command: 'help', description: 'Помощь / Help' }] })).json();
      return J({ webhook: a, menu: b, commands: c });
    }
    if (u.pathname === '/admin/testinvoice' && u.searchParams.get('key') === env.WEBHOOK_SECRET) {
      const r = await tg(env, 'createInvoiceLink', { title: 'Монеты Империи', description: 'Тест', payload: JSON.stringify({ k: 0, u: '0' }), provider_token: '', currency: 'XTR', prices: [{ label: 'Тест', amount: PACKS[0][1] }] });
      return J(await r.json());
    }
    if (u.pathname === '/admin/payout' && u.searchParams.get('key') === env.WEBHOOK_SECRET)
      return J(await payout(env, u.searchParams.get('m')));
    if (req.method === 'POST' && u.pathname === '/webhook/' + env.WEBHOOK_SECRET) {
      await bot(await req.json(), env);
      return new Response('ok');
    }
    return new Response('Durak Empire server v' + VERSION);
  },
  // 1-го числа каждого месяца (cron): награждаем итоги прошлого месяца
  async scheduled(_ev, env, ctx) { ctx.waitUntil(payout(env)); },
};

async function payout(env, m) {
  if (!m) { const n = new Date(); m = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() - 1, 1)).toISOString().slice(0, 7); }
  const list = await stub('STATS', env).payout(m);
  for (const a of list)
    await tg(env, 'sendMessage', { chat_id: a.id, text: `🏆 Durak Empire: ${a.note}!\n+${a.coins} 🪙` }).catch(() => {});
  return { month: m, awarded: list.length };
}

async function tg(env, method, body) {
  return fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
}

// ---------------- Telegram-бот: приветствие с картинкой/видео, FAQ-поддержка, Stars ----------------
const TXT = {
  ru: {
    hi: '👑 <b>Durak Empire</b> — подкидной дурак в Telegram\n\n🃏 Столы на 2–4 игрока, боты трёх уровней\n🏆 Лига месяца с наградами\n💬 Эмоции и чат за столом\n\nЖми «Играть» и стань легендой!',
    invite: '🃏 Вас пригласили за стол. Присоединяйтесь!', play: '🃏 Играть', help: '❓ Помощь',
    menu: 'Чем помочь? Выберите вопрос или напишите своё сообщение — я передам его разработчику.',
    q: { rules: '📖 Правила', pay: '💎 Оплата и монеты', prize: '🏆 Лига и призы', bug: '🛠 Сообщить об ошибке' },
    a: {
      rules: '📖 <b>Правила</b>\nПодкидной дурак, колода 36 карт. У каждого по 6 карт, козырь — масть нижней карты колоды. Атакующий ходит, защитник бьёт старшей картой той же масти или козырем; не можешь бить — берёшь. Подкидывать можно карты тех же рангов, что уже на столе. Кто первым избавился от карт — победитель, последний с картами — дурак.',
      pay: '💎 <b>Оплата и монеты</b>\nМонеты покупаются за Telegram Stars в разделе «Магазин». Если оплата прошла, а монет нет — полностью закройте и снова откройте игру, они зачислятся за несколько секунд. Не помогло — напишите сюда «ошибка» и опишите проблему.',
      prize: '🏆 <b>Лига месяца</b>\nПобеждайте в онлайн-партиях с людьми. 1-го числа топ-3 получают 10 000 / 5 000 / 2 500 монет, а все, кто сыграл 20+ партий, — 500 монет. Награда приходит автоматически.',
      bug: '🛠 Опишите проблему одним сообщением: что нажали и что произошло. Я передам разработчику.',
    },
    thanks: '✅ Спасибо! Сообщение передано разработчику.',
    paid: n => `💎 Спасибо за покупку! ${n} 🪙 уже ждут вас в игре.`, don: '❤️ Огромное спасибо за поддержку проекта! Бонусные монеты уже ждут вас в игре.',
  },
  en: {
    hi: '👑 <b>Durak Empire</b> — Durak card game in Telegram\n\n🃏 Tables for 2–4 players, bots on three levels\n🏆 Monthly league with rewards\n💬 Emotes and chat at the table\n\nTap “Play” and become a legend!',
    invite: '🃏 You are invited to a table. Join in!', play: '🃏 Play', help: '❓ Help',
    menu: 'How can I help? Pick a question or write your own message — I will pass it to the developer.',
    q: { rules: '📖 Rules', pay: '💎 Payments & coins', prize: '🏆 League & prizes', bug: '🛠 Report a bug' },
    a: {
      rules: '📖 <b>Rules</b>\nPodkidnoy Durak, 36-card deck. Everyone gets 6 cards; the trump is the suit of the bottom deck card. The attacker leads, the defender beats with a higher card of the same suit or a trump; if you can’t beat — you take. Others may throw in cards of ranks already on the table. First to get rid of all cards wins; the last one holding cards is the durak.',
      pay: '💎 <b>Payments & coins</b>\nCoins are bought with Telegram Stars in the “Shop”. If you paid but have no coins — fully close and reopen the game, they arrive within seconds. Still nothing — write “bug” here and describe the problem.',
      prize: '🏆 <b>Monthly league</b>\nWin online games against people. On the 1st the top 3 get 10,000 / 5,000 / 2,500 coins, and everyone who played 20+ games gets 500 coins. Rewards arrive automatically.',
      bug: '🛠 Describe the problem in one message: what you tapped and what happened. I will pass it to the developer.',
    },
    thanks: '✅ Thanks! Your message was passed to the developer.',
    paid: n => `💎 Thanks for your purchase! ${n} 🪙 are waiting in the game.`, don: '❤️ Huge thanks for supporting the project! Bonus coins are waiting in the game.',
  },
  uk: {
    hi: '👑 <b>Durak Empire</b> — підкидний дурень у Telegram\n\n🃏 Столи на 2–4 гравці, боти трьох рівнів\n🏆 Ліга місяця з нагородами\n💬 Емоції та чат за столом\n\nНатискай «Грати» і стань легендою!',
    invite: '🃏 Вас запросили за стіл. Приєднуйтесь!', play: '🃏 Грати', help: '❓ Допомога',
    menu: 'Чим допомогти? Оберіть питання або напишіть своє повідомлення — я передам його розробнику.',
    q: { rules: '📖 Правила', pay: '💎 Оплата і монети', prize: '🏆 Ліга і призи', bug: '🛠 Повідомити про помилку' },
    a: {
      rules: '📖 <b>Правила</b>\nПідкидний дурень, колода 36 карт. У кожного по 6 карт, козир — масть нижньої карти колоди. Атакуючий ходить, захисник б’є старшою картою тієї ж масті або козирем; не можеш бити — береш. Підкидати можна карти тих самих рангів, що вже на столі. Хто першим позбувся карт — переможець, останній з картами — дурень.',
      pay: '💎 <b>Оплата і монети</b>\nМонети купуються за Telegram Stars у розділі «Магазин». Якщо оплата пройшла, а монет немає — повністю закрийте й знову відкрийте гру, вони зарахуються за кілька секунд. Не допомогло — напишіть сюди «помилка» й опишіть проблему.',
      prize: '🏆 <b>Ліга місяця</b>\nПеремагайте в онлайн-партіях з людьми. 1-го числа топ-3 отримують 10 000 / 5 000 / 2 500 монет, а всі, хто зіграв 20+ партій, — 500 монет. Нагорода приходить автоматично.',
      bug: '🛠 Опишіть проблему одним повідомленням: що натиснули і що сталося. Я передам розробнику.',
    },
    thanks: '✅ Дякуємо! Повідомлення передано розробнику.',
    paid: n => `💎 Дякуємо за покупку! ${n} 🪙 уже чекають у грі.`, don: '❤️ Величезне дякую за підтримку проєкту! Бонусні монети вже чекають у грі.',
  },
};
const langOf = f => { const c = String((f && f.language_code) || 'en'); return /^uk/.test(c) ? 'uk' : /^(ru|be|kk)/.test(c) ? 'ru' : 'en'; };
const KW = { rules: /правил|как игра|rules|how to play|як грати/i, pay: /оплат|монет|звезд|звёзд|купи|stars|pay|coin|buy|купив|плат/i, prize: /приз|награ|лига|рейтинг|league|prize|reward|rank|ліга|нагород/i, bug: /ошибк|баг|не работ|bug|error|помилк|не працю/i };

async function bot(up, env) {
  if (up.pre_checkout_query) { // Stars: подтверждаем заказ перед оплатой
    const q = up.pre_checkout_query;
    let ok = false;
    try { const p = JSON.parse(q.invoice_payload); ok = q.currency === 'XTR' && String(q.from.id) === p.u && (p.d ? DONATE.includes(p.d) && q.total_amount === p.d : !!PACKS[p.k] && q.total_amount === PACKS[p.k][1]); } catch (_) {}
    await tg(env, 'answerPreCheckoutQuery', ok ? { pre_checkout_query_id: q.id, ok: true } : { pre_checkout_query_id: q.id, ok: false, error_message: 'Order error' });
    return;
  }
  if (up.callback_query) {
    const q = up.callback_query, T = TXT[langOf(q.from)];
    await tg(env, 'answerCallbackQuery', { callback_query_id: q.id });
    const a = T.a[q.data];
    if (a) await tg(env, 'sendMessage', { chat_id: q.message.chat.id, text: a, parse_mode: 'HTML', reply_markup: kbPlay(env, T) });
    return;
  }
  const m = up.message;
  if (!m) return;
  const T = TXT[langOf(m.from)];
  if (m.successful_payment) { // Stars: оплата прошла — копим монеты игроку, он получит их при входе в игру
    const sp = m.successful_payment;
    let p; try { p = JSON.parse(sp.invoice_payload); } catch (_) { return; }
    const uid = String(m.from.id);
    if (sp.currency !== 'XTR') return;
    if (p.d) {
      if (!DONATE.includes(p.d) || sp.total_amount !== p.d) return;
      await stub('STATS', env).buy(uid, p.d * 10, '❤️ Спасибо за поддержку!', sp.telegram_payment_charge_id);
      await tg(env, 'sendMessage', { chat_id: m.chat.id, text: T.don });
    } else {
      const pk = PACKS[p.k];
      if (!pk || sp.total_amount !== pk[1]) return;
      await stub('STATS', env).buy(uid, pk[0], '💎 Покупка: ' + pk[0] + ' монет', sp.telegram_payment_charge_id);
      await tg(env, 'sendMessage', { chat_id: m.chat.id, text: T.paid(pk[0]) });
    }
    return;
  }
  if (!m.text) return;
  const txt = m.text.trim();
  if (txt.startsWith('/start')) {
    const room = (txt.split(' ')[1] || '').replace(/[^\w-]/g, '');
    const url = APP(env) + (room ? '?room=' + room : '');
    const kb = { inline_keyboard: [[{ text: T.play, web_app: { url } }], [{ text: T.help, callback_data: 'menu' }]] };
    if (room) { await tg(env, 'sendMessage', { chat_id: m.chat.id, text: T.invite, reply_markup: kb }); return; }
    const cap = { chat_id: m.chat.id, caption: T.hi, parse_mode: 'HTML', reply_markup: kb };
    let ok = false;
    if (env.WELCOME_VIDEO) ok = (await (await tg(env, 'sendVideo', { ...cap, video: APP(env) + env.WELCOME_VIDEO, supports_streaming: true })).json().catch(() => ({}))).ok;
    if (!ok) ok = (await (await tg(env, 'sendPhoto', { ...cap, photo: APP(env) + 'welcome.jpg' })).json().catch(() => ({}))).ok;
    if (!ok) await tg(env, 'sendMessage', { chat_id: m.chat.id, text: T.hi, parse_mode: 'HTML', reply_markup: kb });
    return;
  }
  const faqKb = { inline_keyboard: [...Object.keys(T.q).map(k => [{ text: T.q[k], callback_data: k }]), [{ text: T.play, web_app: { url: APP(env) } }]] };
  if (txt.startsWith('/help') || txt === 'menu') { await tg(env, 'sendMessage', { chat_id: m.chat.id, text: T.menu, reply_markup: faqKb }); return; }
  for (const k of ['rules', 'pay', 'prize', 'bug'])
    if (KW[k].test(txt)) { await tg(env, 'sendMessage', { chat_id: m.chat.id, text: T.a[k], parse_mode: 'HTML', reply_markup: kbPlay(env, T) }); return; }
  if (env.ADMIN_ID) { // любое другое сообщение — разработчику
    await tg(env, 'sendMessage', { chat_id: env.ADMIN_ID, text: `📩 ${m.from.first_name || ''} @${m.from.username || '-'} (id ${m.from.id}):\n${txt.slice(0, 1000)}` }).catch(() => {});
    await tg(env, 'sendMessage', { chat_id: m.chat.id, text: T.thanks, reply_markup: kbPlay(env, T) });
  } else await tg(env, 'sendMessage', { chat_id: m.chat.id, text: T.menu, reply_markup: faqKb });
}
const kbPlay = (env, T) => ({ inline_keyboard: [[{ text: T.play, web_app: { url: APP(env) } }]] });

// ---------------- проверка подписи Telegram (initData) ----------------
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
    const pic = /^https:\/\/t\.me\/[\w\/.\-]+$/.test(u.photo_url || '') ? u.photo_url : '';
    return { id: String(u.id), name, pic };
  } catch (_) { return null; }
}

// ---------------- лига месяца: статистика, награды, покупки (SQLite в Durable Object) ----------------
export class Stats extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS st(m TEXT,id TEXT,name TEXT,w INT DEFAULT 0,g INT DEFAULT 0,d TEXT DEFAULT '',bd INT DEFAULT 0,PRIMARY KEY(m,id))`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS pend(id TEXT PRIMARY KEY,coins INT DEFAULT 0,note TEXT DEFAULT '')`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS paid(m TEXT PRIMARY KEY)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS pay(cid TEXT PRIMARY KEY)`);
  }
  mk() { return new Date().toISOString().slice(0, 7); }
  touch(id, name) {
    const m = this.mk();
    this.sql.exec('INSERT INTO st(m,id,name) VALUES(?,?,?) ON CONFLICT(m,id) DO UPDATE SET name=excluded.name', m, id, name);
    return m;
  }
  game(list) { // итоги онлайн-партии: [{uid,name,res}]
    for (const r of list) {
      const m = this.touch(r.uid, r.name);
      this.sql.exec('UPDATE st SET g=g+1,w=w+? WHERE m=? AND id=?', r.res === 'win' ? 1 : 0, m, r.uid);
    }
  }
  bot(id, name) {
    const m = this.touch(id, name), d = new Date().toISOString().slice(0, 10);
    const r = this.sql.exec('SELECT d,bd FROM st WHERE m=? AND id=?', m, id).toArray()[0];
    const bd = r.d === d ? r.bd : 0;
    if (bd >= BOTCAP) return;
    this.sql.exec('UPDATE st SET g=g+1,d=?,bd=? WHERE m=? AND id=?', d, bd + 1, m, id);
  }
  me(id, name) {
    const m = this.touch(id, name);
    const r = this.sql.exec('SELECT w,g FROM st WHERE m=? AND id=?', m, id).toArray()[0];
    const rank = this.sql.exec('SELECT COUNT(*) AS c FROM st WHERE m=? AND w>?', m, r.w).toArray()[0].c + 1;
    const p = this.sql.exec('SELECT coins,note FROM pend WHERE id=?', id).toArray()[0];
    if (p) this.sql.exec('DELETE FROM pend WHERE id=?', id);
    return { m, w: r.w, g: r.g, rank, award: p ? p.coins : 0, note: p ? p.note : '' };
  }
  buy(id, coins, note, cid) {
    if (this.sql.exec('SELECT 1 FROM pay WHERE cid=?', cid).toArray().length) return;
    this.sql.exec('INSERT INTO pay(cid) VALUES(?)', cid);
    this.addPend(id, coins, note);
  }
  addPend(id, coins, note) {
    this.sql.exec(`INSERT INTO pend(id,coins,note) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET coins=coins+excluded.coins,note=note||' · '||excluded.note`, id, coins, note);
  }
  top() {
    return this.sql.exec('SELECT name,w,g FROM st WHERE m=? AND w>0 ORDER BY w DESC,g ASC LIMIT 10', this.mk()).toArray();
  }
  payout(m) {
    if (this.sql.exec('SELECT 1 FROM paid WHERE m=?', m).toArray().length) return [];
    const out = [];
    const top = this.sql.exec('SELECT id FROM st WHERE m=? AND w>0 ORDER BY w DESC,g ASC LIMIT 3', m).toArray();
    const skip = new Set(top.map(r => r.id));
    top.forEach((r, i) => out.push({ id: r.id, coins: PRIZES[i], note: ['🥇 1 место', '🥈 2 место', '🥉 3 место'][i] + ' в лиге месяца' }));
    this.sql.exec('SELECT id FROM st WHERE m=? AND g>=?', m, ACTMIN).toArray()
      .forEach(r => { if (!skip.has(r.id)) out.push({ id: r.id, coins: ACTIVE, note: 'Награда за активность' }); });
    out.forEach(a => this.addPend(a.id, a.coins, a.note));
    this.sql.exec('INSERT INTO paid(m) VALUES(?)', m);
    return out;
  }
}

// ---------------- лобби: кто онлайн и какие столы открыты (в памяти) ----------------
export class Lobby extends DurableObject {
  constructor(ctx, env) { super(ctx, env); this.pres = new Map(); this.tb = new Map(); }
  beat(id) { this.pres.set(id, Date.now()); }
  table(id, info) { if (info) this.tb.set(id, { ...info, t: Date.now() }); else this.tb.delete(id); }
  list() {
    const now = Date.now();
    for (const [k, v] of this.pres) if (now - v > 90000) this.pres.delete(k);
    for (const [k, v] of this.tb) if (now - v.t > 900000) this.tb.delete(k);
    return { online: this.pres.size, tables: [...this.tb.entries()].map(([id, v]) => ({ id, host: v.host, n: v.n, filled: v.filled, bots: v.bots })).slice(0, 30) };
  }
}

// ---------------- онлайн-стол на 2–4 игрока (люди + боты) ----------------
export class Room {
  constructor(state, env) {
    this.env = env; this.id = ''; this.n = 2; this.pub = 1; this.seat = []; this.host = 0;
    this.g = null; this.re = {}; this.pt = null; this.tm = null; this.tl = 0;
  }
  humans() { return this.seat.map((s, i) => s && !s.bot ? i : -1).filter(i => i >= 0); }
  async fetch(req) {
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('ws only', { status: 426 });
    const q = new URL(req.url).searchParams;
    const usr = await verify(q.get('init'), this.env);
    const name = usr ? usr.name : (q.get('name') || 'Игрок').replace(/[<>&"'`]/g, '').slice(0, 20);
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    if (!this.id) { // первый вошедший создаёт стол
      this.id = (q.get('room') || '').toUpperCase();
      this.n = Math.min(4, Math.max(2, Number(q.get('n')) || 2));
      this.pub = q.get('pub') === '0' ? 0 : 1;
      this.seat = Array(this.n).fill(null);
    }
    const i = this.seat.findIndex(x => !x);
    if (i < 0 || (this.g && !this.g.over)) { server.send(JSON.stringify({ t: 'full' })); server.close(); return new Response(null, { status: 101, webSocket: client }); }
    this.seat[i] = { ws: server, name, uid: usr ? usr.id : null, pic: usr ? usr.pic : '', bot: 0, last: 0, afk: 0 };
    if (!this.humans().includes(this.host) || this.seat[this.host].bot) this.host = i;
    server.addEventListener('message', e => { try { if (String(e.data).length < 400) this.msg(i, JSON.parse(e.data)); } catch (_) {} });
    server.addEventListener('close', () => this.leave(i, server));
    this.lobby();
    this.ready();
    return new Response(null, { status: 101, webSocket: client });
  }
  send(i, o) { const s = this.seat[i]; if (s && s.ws && !s.bot) try { s.ws.send(JSON.stringify(o)); } catch (_) {} }
  all(o) { this.seat.forEach((_, i) => this.send(i, o)); }
  ready() { // все места заняты — начинаем, иначе показываем ожидание
    if (this.seat.every(Boolean)) return this.deal();
    this.seat.forEach((_, i) => this.send(i, { t: 'wait', code: this.id, n: this.n, host: i === this.host, seats: this.seat.map(s => s && { name: s.name, bot: !!s.bot }) }));
  }
  lobby() {
    const g = this.g && !this.g.over, hs = this.humans();
    const info = !this.pub || g || !hs.length || this.seat.every(Boolean) ? null : { host: this.seat[hs[0]].name, n: this.n, filled: this.seat.filter(Boolean).length, bots: this.seat.filter(s => s && s.bot).length };
    try { stub('LOBBY', this.env).table(this.id, info); } catch (_) {}
  }
  leave(i, ws) {
    const s = this.seat[i];
    if (!s || s.ws !== ws) return;
    if (this.g && !this.g.over) { // в игре: место переходит к боту
      s.ws = null; s.bot = 1; s.lvl = 'medium'; s.left = 1; s.name += ' 🤖';
      if (!this.humans().length) return this.close();
      this.after();
    } else {
      this.seat[i] = null;
      if (!this.humans().length) return this.close();
      if (this.host === i) this.host = this.humans()[0];
      this.lobby(); this.ready();
    }
  }
  close() { clearTimeout(this.tm); clearTimeout(this.pt); this.g = null; try { stub('LOBBY', this.env).table(this.id, null); } catch (_) {} this.seat = Array(this.n).fill(null); }
  deal() {
    this.g = gNew(this.n); this.re = {};
    this.seat.forEach(s => { if (s) s.afk = 0; });
    this.lobby(); this.after();
  }
  msg(i, m) {
    const s = this.seat[i], now = Date.now(); if (!s || now - s.last < 60) return; s.last = now;
    const g = this.g;
    if (m.t === 'addbot') {
      if (g && !g.over || i !== this.host || !['easy', 'medium', 'hard'].includes(m.lvl)) return;
      const k = this.seat.findIndex(x => !x); if (k < 0) return;
      const pi = Math.random() * BOTNAMES.length | 0;
      this.seat[k] = { bot: 1, lvl: m.lvl, name: BOTNAMES[pi], pic: 'av:' + pi };
      this.lobby(); this.ready(); return;
    }
    if (m.t === 'again') {
      if (!g || !g.over) return;
      this.re[i] = 1;
      if (this.seat.every(Boolean) && this.humans().every(h => this.re[h])) this.deal();
      else if (!this.seat.every(Boolean) && this.humans().every(h => this.re[h])) { this.g = null; this.lobby(); this.ready(); }
      return;
    }
    if (m.t === 'emo') { if (EMO.includes(m.e)) this.all({ t: 'emo', from: i, e: m.e }); return; }
    if (m.t === 'chat') { const x = String(m.m || '').replace(/[<>&"'`]/g, '').trim().slice(0, 40); if (x && now - (s.chat || 0) > 1200) { s.chat = now; this.all({ t: 'chat', from: i, m: x }); } return; }
    if (!g || g.over) return;
    s.afk = 0;
    const ok = m.t === 'play' ? gPlay(g, i, m.i | 0) : m.t === 'act' ? gAct(g, i) : false;
    if (ok) this.after();
  }
  after() {
    const g = this.g; if (!g) return;
    this.push();
    clearTimeout(this.tm);
    if (g.over) return this.finish();
    const act = gActors(g);
    if (act.some(p => this.seat[p] && !this.seat[p].bot)) { this.tl = TURN_MS / 1000; this.tm = setTimeout(() => this.timeout(), TURN_MS); }
    this.pump();
  }
  pump() {
    const g = this.g; if (!g || g.over || this.pt) return;
    if (!gActors(g).some(p => this.seat[p] && this.seat[p].bot)) return;
    this.pt = setTimeout(() => {
      this.pt = null; const g2 = this.g; if (!g2 || g2.over) return;
      const bots = {}; this.seat.forEach((s, i) => { if (s && s.bot) bots[i] = s.lvl; });
      if (aiTurn(g2, bots)) this.after();
    }, 850);
  }
  timeout() { // игрок молчит: делаем ход за него, после двух пропусков — заменяет бот
    const g = this.g; if (!g || g.over) return;
    for (const p of gActors(g)) {
      const s = this.seat[p]; if (!s || s.bot) continue;
      s.afk++;
      const m = aiMove(g, p, 'medium');
      if (m) { const ok = m.t === 'play' ? gPlay(g, p, m.i) : gAct(g, p); if (!ok) gAct(g, p); }
      if (s.afk >= 2) { s.bot = 1; s.lvl = 'medium'; s.name += ' 🤖'; s.afk = 0; }
    }
    this.after();
  }
  push() {
    const g = this.g, names = this.seat.map(s => s ? s.name : ''), pics = this.seat.map(s => s ? s.pic || '' : '');
    this.seat.forEach((_, i) => this.send(i, { t: 'state', ...gView(g, i), names, pics, tl: this.tl }));
  }
  finish() {
    const g = this.g;
    this.seat.forEach((s, i) => this.send(i, { t: 'over', res: gRes(g, i), dn: g.durak >= 0 ? this.seat[g.durak].name : '' }));
    const hs = this.seat.map((s, i) => s && s.uid ? { uid: s.uid, name: s.name.replace(' 🤖', ''), res: s.left ? 'lose' : gRes(g, i) } : null).filter(Boolean);
    // в лигу идут партии минимум двух разных людей и не короче 3 раундов
    if (new Set(hs.map(x => x.uid)).size >= 2 && g.rd >= 3) try { stub('STATS', this.env).game(hs).catch(() => {}); } catch (_) {}
    this.lobby();
  }
}
