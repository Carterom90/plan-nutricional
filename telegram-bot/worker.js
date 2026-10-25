// ─────────────────────────────────────────────────────────────
//  Balance · Bot de tickets (Cloudflare Worker)
//
//  Telegram (foto del ticket) → Gemini/Claude lee el ticket → confirmas con
//  botones → se guarda en Firebase Realtime Database con el mismo
//  formato que usa la app (budget_AAAA_MM, mes 0-based).
//
//  Secretos (Worker → Settings → Variables and Secrets):
//    TELEGRAM_TOKEN            token de @BotFather
//    TELEGRAM_SECRET           cadena aleatoria; Telegram la manda en cada llamada
//    ALLOWED_CHAT_ID           tu chat ID (el bot te lo dice con /id)
//    GEMINI_API_KEY            clave de aistudio.google.com (gratis)   ┐ pon UNA de las dos;
//    ANTHROPIC_API_KEY         clave de console.anthropic.com (pago)   ┘ si están las dos, gana Gemini
//    FIREBASE_SERVICE_ACCOUNT  JSON completo de la cuenta de servicio
//    FIREBASE_DB_URL           https://presupuesto-7e988-default-rtdb.europe-west1.firebasedatabase.app
//  Variables opcionales:
//    WHO     nombre que aparece en el registro (por defecto "Mario")
//    GEMINI_MODEL  modelo de Gemini (por defecto "gemini-flash-latest")
//    MODEL         modelo de Claude (por defecto "claude-sonnet-5-5")
// ─────────────────────────────────────────────────────────────

const MO = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

// Copia exacta de defS() de la app: se usa si el mes aún no existe.
function defS(){
  return {
    income: { name:'Sueldo neto', amount:0 },
    categories: [
      { name:'Vivienda',       icon:'🏠', color:'#4ab8e8', entries:[] },
      { name:'Alimentación',   icon:'🛒', color:'#1fcc8a', entries:[] },
      { name:'Transporte',     icon:'🚗', color:'#7c6fff', entries:[] },
      { name:'Ocio',           icon:'🎬', color:'#e879a0', entries:[] },
      { name:'Facturas',       icon:'💡', color:'#f5a623', entries:[] },
      { name:'Salud',          icon:'💊', color:'#ff6b6b', entries:[] },
      { name:'Restaurantes',   icon:'🍽️', color:'#f5a623', entries:[] },
      { name:'Comida',         icon:'🥘', color:'#f5a623', entries:[] },
      { name:'Compras Online', icon:'🛍️', color:'#7c6fff', entries:[] },
      { name:'Suscripciones',  icon:'🔄', color:'#4ab8e8', entries:[] },
      { name:'Regalo',         icon:'🎁', color:'#e879a0', entries:[] },
      { name:'Otros',          icon:'📦', color:'#888890', entries:[], isOtros:true },
    ]
  };
}

const pad = n => String(n).padStart(2,'0');
const monthKey = (y,m) => `budget_${y}_${pad(m)}`;            // m 0-based, igual que la app
const eur = n => (Math.round(n*100)/100).toLocaleString('es-ES',{minimumFractionDigits:2,maximumFractionDigits:2})+' €';
const h = s => String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

// ── ENTRADA ──────────────────────────────────────────────────
export default {
  async fetch(req, env, ctx){
    if(req.method !== 'POST') return new Response('Balance bot OK');
    // Solo Telegram conoce el secreto del webhook.
    if(req.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.TELEGRAM_SECRET)
      return new Response('forbidden', {status:403});
    const update = await req.json().catch(()=>null);
    if(!update) return new Response('ok');
    // Se responde ya a Telegram (evita reintentos) y se trabaja en segundo plano.
    ctx.waitUntil(handle(update, env).catch(e=>console.error('handle', e && e.stack || e)));
    return new Response('ok');
  }
};

async function handle(u, env){
  if(u.message)        return onMessage(u.message, env);
  if(u.callback_query) return onCallback(u.callback_query, env);
}

// ── MENSAJES ─────────────────────────────────────────────────
async function onMessage(msg, env){
  const chat = msg.chat.id;
  if(msg.text && msg.text.trim() === '/id')
    return tg(env,'sendMessage',{chat_id:chat, text:`Tu chat ID es: ${chat}`});
  if(String(chat) !== String(env.ALLOWED_CHAT_ID)) return;   // cualquier otro chat se ignora

  let fileId = null, mime = 'image/jpeg';
  if(msg.photo && msg.photo.length){
    fileId = msg.photo[msg.photo.length-1].file_id;           // la de mayor resolución
  } else if(msg.document && /^image\/(jpeg|png|webp)$/.test(msg.document.mime_type||'')){
    if((msg.document.file_size||0) > 4_500_000)
      return tg(env,'sendMessage',{chat_id:chat, text:'La imagen es demasiado grande. Mándala como foto, no como archivo.'});
    fileId = msg.document.file_id; mime = msg.document.mime_type;
  } else {
    return tg(env,'sendMessage',{chat_id:chat, text:'Mándame una foto del ticket o una captura del pago y lo apunto en Balance 🧾'});
  }

  const status = await tg(env,'sendMessage',{chat_id:chat, text:'🧾 Leyendo ticket…', reply_to_message_id:msg.message_id});
  const msgId = status.result.message_id;

  try{
    const img = await downloadTelegramFile(env, fileId);
    const today = madridToday();
    const cats = await categoriesFor(env, today.y, today.m);
    const t = await readTicket(env, img, mime, cats, today.iso);
    if(t.es_ingreso){
      return tg(env,'editMessageText',{chat_id:chat, message_id:msgId,
        text:'Eso es un ingreso, no un gasto. Los ingresos se apuntan a mano en Balance.'});
    }
    if(!t.es_ticket || !(t.total > 0) || !t.grupos?.length){
      return tg(env,'editMessageText',{chat_id:chat, message_id:msgId,
        text:'No he podido leer un ticket ni un pago en esa imagen. Prueba con más luz o con una captura completa.'});
    }
    const fecha = sanitizeDate(t.fecha, today.iso);
    const data = {
      comercio: (t.comercio||'Ticket').trim().slice(0,60),
      fecha,
      total: round2(t.total),
      grupos: t.grupos.map(g=>({categoria:g.categoria, importe:round2(g.importe), detalle:(g.detalle||'').slice(0,60)}))
                      .filter(g=>g.importe>0),
      cats: cats.map(c=>({name:c.name, icon:c.icon})),
    };
    if(!data.grupos.length) data.grupos = [{categoria: guessOtros(cats), importe:data.total, detalle:''}];
    const id = crypto.randomUUID().replace(/-/g,'').slice(0,10);
    await fb(env,'PUT',`ticket_pending/${id}`, {chat, msgId, created:Date.now(), data});
    await renderPending(env, chat, msgId, id, data);
  }catch(e){
    console.error(e && e.stack || e);
    await tg(env,'editMessageText',{chat_id:chat, message_id:msgId, text:'⚠️ Error leyendo el ticket: '+String(e.message||e).slice(0,200)});
  }
}

// ── BOTONES ──────────────────────────────────────────────────
async function onCallback(cq, env){
  const chat = cq.message?.chat?.id, msgId = cq.message?.message_id;
  if(String(chat) !== String(env.ALLOWED_CHAT_ID)) return tg(env,'answerCallbackQuery',{callback_query_id:cq.id});
  const [action, id, arg] = (cq.data||'').split(':');
  const pend = await fbGetEtag(env, `ticket_pending/${id}`);
  if(!pend.value){
    await tg(env,'answerCallbackQuery',{callback_query_id:cq.id, text:'Este ticket ya se procesó.'});
    return tg(env,'editMessageReplyMarkup',{chat_id:chat, message_id:msgId, reply_markup:{inline_keyboard:[]}}).catch(()=>{});
  }
  const data = pend.value.data;

  if(action === 'x'){                                   // descartar
    await fb(env,'DELETE',`ticket_pending/${id}`);
    await tg(env,'answerCallbackQuery',{callback_query_id:cq.id, text:'Descartado'});
    return tg(env,'editMessageText',{chat_id:chat, message_id:msgId, parse_mode:'HTML',
      text:'❌ <s>'+h(data.comercio)+' · '+eur(data.total)+'</s>\nDescartado.'});
  }
  if(action === 'c'){                                   // elegir categoría
    await tg(env,'answerCallbackQuery',{callback_query_id:cq.id});
    const rows = [];
    data.cats.forEach((c,i)=>{
      const b = {text:`${c.icon} ${c.name}`, callback_data:`k:${id}:${i}`};
      if(i%2===0) rows.push([b]); else rows[rows.length-1].push(b);
    });
    rows.push([{text:'↩️ Volver', callback_data:`b:${id}`}]);
    return tg(env,'editMessageReplyMarkup',{chat_id:chat, message_id:msgId, reply_markup:{inline_keyboard:rows}});
  }
  if(action === 'k'){                                   // todo a una categoría
    const c = data.cats[+arg];
    if(c){
      data.grupos = [{categoria:c.name, importe:data.total, detalle:''}];
      await fb(env,'PATCH',`ticket_pending/${id}`, {data});
    }
    await tg(env,'answerCallbackQuery',{callback_query_id:cq.id, text: c ? `→ ${c.name}` : ''});
    return renderPending(env, chat, msgId, id, data);
  }
  if(action === 'b'){                                   // volver
    await tg(env,'answerCallbackQuery',{callback_query_id:cq.id});
    return renderPending(env, chat, msgId, id, data);
  }
  if(action === 's'){                                   // guardar
    // Se "reserva" el ticket borrándolo con if-match: un doble toque no lo guarda dos veces.
    const del = await fbRaw(env,'DELETE',`ticket_pending/${id}`, null, {'if-match':pend.etag});
    if(del.status === 412){
      return tg(env,'answerCallbackQuery',{callback_query_id:cq.id, text:'Ya se está guardando.'});
    }
    await tg(env,'answerCallbackQuery',{callback_query_id:cq.id, text:'Guardando…'});
    try{
      const where = await saveToMonth(env, data);
      return tg(env,'editMessageText',{chat_id:chat, message_id:msgId, parse_mode:'HTML',
        text: summary(data) + `\n\n✅ Guardado en <b>${where}</b>`});
    }catch(e){
      console.error(e && e.stack || e);
      await fb(env,'PUT',`ticket_pending/${id}`, pend.value);   // se restaura para reintentar
      return tg(env,'sendMessage',{chat_id:chat, text:'⚠️ No se pudo guardar: '+String(e.message||e).slice(0,200)+'\nPulsa Guardar otra vez.'});
    }
  }
  return tg(env,'answerCallbackQuery',{callback_query_id:cq.id});
}

function summary(d){
  const [y,m,dd] = d.fecha.split('-');
  const icon = n => (d.cats.find(c=>c.name===n)||{}).icon || '📦';
  let t = `🧾 <b>${h(d.comercio)}</b> · ${dd}/${m}/${y}\nTotal: <b>${eur(d.total)}</b>\n`;
  for(const g of d.grupos)
    t += `\n${icon(g.categoria)} ${h(g.categoria)} — ${eur(g.importe)}${d.grupos.length>1 && g.detalle ? ` <i>(${h(g.detalle)})</i>` : ''}`;
  const sum = d.grupos.reduce((s,g)=>s+g.importe,0);
  if(Math.abs(sum - d.total) > 0.05)
    t += `\n\n⚠️ Las categorías suman ${eur(sum)} y el total es ${eur(d.total)}. Usa «Todo a una categoría» para guardar el total.`;
  return t;
}

function renderPending(env, chat, msgId, id, d){
  const [y,m] = d.fecha.split('-').map(Number);
  return tg(env,'editMessageText',{chat_id:chat, message_id:msgId, parse_mode:'HTML',
    text: summary(d) + `\n\n→ Se guardará en <b>${MO[m-1]} ${y}</b>`,
    reply_markup:{inline_keyboard:[
      [{text:'✅ Guardar', callback_data:`s:${id}`},{text:'❌ Descartar', callback_data:`x:${id}`}],
      [{text:'🔄 Todo a una categoría', callback_data:`c:${id}`}],
    ]}});
}

// ── GUARDAR EN EL MES ────────────────────────────────────────
async function saveToMonth(env, d){
  const [y,m,dd] = d.fecha.split('-').map(Number);
  const key = monthKey(y, m-1);
  const ts = Date.UTC(y, m-1, dd, 11, 0, 0);           // 12:00/13:00 en Madrid
  const who = env.WHO || 'Mario';
  const many = d.grupos.length > 1;

  for(let attempt=0; attempt<5; attempt++){
    const cur = await fbGetEtag(env, key);
    const S = cur.value || defS();
    if(!Array.isArray(S.categories)) S.categories = Object.values(S.categories||{});
    S.categories.forEach(c=>{ if(!Array.isArray(c.entries)) c.entries = Object.values(c.entries||{}); });
    if(!S.categories.some(c=>c.isOtros))
      S.categories.push({ name:'Otros', icon:'📦', color:'#888890', entries:[], isOtros:true });

    for(const g of d.grupos){
      const cat = S.categories.find(c=>c.name===g.categoria) || S.categories.find(c=>c.isOtros);
      cat.entries.push({
        desc: many && g.detalle ? `${d.comercio} · ${g.detalle}` : d.comercio,
        amount: g.importe, who, ts,
      });
    }
    // if-match: si la app ha escrito en este mes entre medias, se relee y se reintenta.
    const res = await fbRaw(env,'PUT', key, S, {'if-match': cur.etag});
    if(res.ok) return `${MO[m-1]} ${y}`;
    if(res.status !== 412) throw new Error(`Firebase ${res.status}: ${(await res.text()).slice(0,150)}`);
  }
  throw new Error('El mes cambió varias veces mientras se guardaba.');
}

async function categoriesFor(env, y, m){
  const r = await fbGetEtag(env, monthKey(y,m));
  let cats = r.value?.categories;
  if(cats && !Array.isArray(cats)) cats = Object.values(cats);
  if(!cats || !cats.length) cats = defS().categories;
  return cats.filter(c=>c && c.name).map(c=>({name:c.name, icon:c.icon||'📦', isOtros:!!c.isOtros}));
}
const guessOtros = cats => (cats.find(c=>c.isOtros)||cats[cats.length-1]).name;

// ── LECTURA DEL TICKET (Gemini gratis o Claude) ──────────────
async function readTicket(env, imgBuf, mime, cats, todayIso){
  const names = cats.map(c=>c.name);
  const prompt = ticketPrompt(cats, todayIso);
  const t = env.GEMINI_API_KEY
    ? await readWithGemini(env, imgBuf, mime, names, prompt)
    : await readWithClaude(env, imgBuf, mime, names, prompt);
  // Por si acaso: cualquier categoría que no exista va a Otros.
  if(!Array.isArray(t.grupos)) t.grupos = [];
  t.grupos.forEach(g=>{ if(!names.includes(g.categoria)) g.categoria = guessOtros(cats); });
  return t;
}

function ticketPrompt(cats, todayIso){
  return `Lee esta imagen y apunta el gasto en mi presupuesto. Hoy es ${todayIso}.
Puede ser un ticket de compra (España) o una captura de un pago en la app del banco
(Revolut, BBVA, Bizum, pago con tarjeta, transferencia…).

Categorías disponibles (usa SOLO estos nombres exactos): ${cats.map(c=>`${c.icon} ${c.name}`).join(', ')}.

Reglas:
- "total": importe TOTAL pagado, en euros, tal y como aparece (con IVA, descuentos ya aplicados).
- "fecha": fecha del ticket o del pago en formato YYYY-MM-DD. Si no aparece el año, usa el año
  de hoy (o el anterior si así la fecha quedaría en el futuro). Si no se lee, cadena vacía.
- "comercio": nombre corto del comercio (ej. "Mercadona", "Lidl", "Repsol"). En un Bizum o
  transferencia a una persona: "Bizum a <nombre>" o "Transferencia a <nombre>", con el nombre corto.
- En capturas del banco el importe sale en negativo (ej. "-20 €"): usa el valor positivo.
- "grupos": reparte el total entre las categorías. Lo normal es UN solo grupo con todo el total.
  Solo separa si hay productos claramente de otra categoría con importe relevante (> 3 €).
  Reparte los descuentos proporcionalmente. La suma de grupos debe ser igual al total.
  "detalle": 2-4 palabras sobre qué incluye ese grupo (ej. "droguería", "comida").
- Supermercado → Alimentación. Bar/restaurante → Restaurantes. Gasolinera/parking → Transporte.
  Farmacia → Salud. Si dudas, usa la categoría más parecida; si no encaja ninguna, ${guessOtros(cats)}.
- Pagos a una persona (Bizum, transferencia) sin concepto que indique la categoría → ${guessOtros(cats)}.
  Si hay concepto (ej. "cena", "regalo Ana", "luz"), úsalo para elegir la categoría y como "detalle".
- Si es dinero RECIBIDO (ingreso, Bizum recibido, importe positivo con "+"), es_ingreso = true.
- Si la imagen no es un ticket, factura ni pago legible, es_ticket = false.`;
}

async function readWithGemini(env, imgBuf, mime, names, prompt){
  const model = env.GEMINI_MODEL || 'gemini-flash-latest';
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,{
    method:'POST',
    headers:{'x-goog-api-key': env.GEMINI_API_KEY, 'content-type':'application/json'},
    body: JSON.stringify({
      contents:[{role:'user', parts:[
        {inline_data:{mime_type:mime, data:toBase64(imgBuf)}},
        {text:prompt},
      ]}],
      generationConfig:{
        temperature:0,
        responseMimeType:'application/json',
        responseSchema:{
          type:'OBJECT',
          properties:{
            es_ticket:{type:'BOOLEAN'},
            es_ingreso:{type:'BOOLEAN'},
            comercio:{type:'STRING'},
            fecha:{type:'STRING', description:'YYYY-MM-DD o vacío'},
            total:{type:'NUMBER'},
            grupos:{type:'ARRAY', items:{type:'OBJECT', properties:{
              categoria:{type:'STRING', enum:names},
              importe:{type:'NUMBER'},
              detalle:{type:'STRING'},
            }, required:['categoria','importe','detalle']}},
          },
          required:['es_ticket','comercio','fecha','total','grupos'],
        },
      },
    }),
  });
  if(res.status === 429) throw new Error('Has llegado al límite gratuito de Gemini por hoy. Prueba más tarde.');
  if(!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0,150)}`);
  const out = await res.json();
  const text = (out.candidates?.[0]?.content?.parts||[]).map(p=>p.text||'').join('');
  if(!text) throw new Error('Gemini no devolvió datos');
  return JSON.parse(text);
}

async function readWithClaude(env, imgBuf, mime, names, prompt){
  const res = await fetch('https://api.anthropic.com/v1/messages',{
    method:'POST',
    headers:{
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version':'2023-06-01',
      'content-type':'application/json',
    },
    body: JSON.stringify({
      model: env.MODEL || 'claude-sonnet-5-5',
      max_tokens: 1024,
      tools:[{
        name:'registrar_ticket',
        description:'Registra los datos leídos del ticket.',
        input_schema:{
          type:'object',
          properties:{
            es_ticket:{type:'boolean'},
            es_ingreso:{type:'boolean'},
            comercio:{type:'string'},
            fecha:{type:'string', description:'YYYY-MM-DD o vacío'},
            total:{type:'number'},
            grupos:{type:'array', items:{type:'object', properties:{
              categoria:{type:'string', enum:names},
              importe:{type:'number'},
              detalle:{type:'string'},
            }, required:['categoria','importe','detalle']}},
          },
          required:['es_ticket','comercio','fecha','total','grupos'],
        },
      }],
      tool_choice:{type:'tool', name:'registrar_ticket'},
      messages:[{role:'user', content:[
        {type:'image', source:{type:'base64', media_type:mime, data:toBase64(imgBuf)}},
        {type:'text', text:prompt},
      ]}],
    }),
  });
  if(!res.ok) throw new Error(`Claude ${res.status}: ${(await res.text()).slice(0,150)}`);
  const out = await res.json();
  const tool = (out.content||[]).find(b=>b.type==='tool_use');
  if(!tool) throw new Error('Claude no devolvió datos');
  return tool.input;
}

// ── TELEGRAM ─────────────────────────────────────────────────
async function tg(env, method, body){
  const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/${method}`,{
    method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(body),
  });
  const j = await r.json();
  if(!j.ok && !/message is not modified/.test(j.description||'')) throw new Error(`Telegram ${method}: ${j.description}`);
  return j;
}

async function downloadTelegramFile(env, fileId){
  const f = await tg(env,'getFile',{file_id:fileId});
  const r = await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_TOKEN}/${f.result.file_path}`);
  if(!r.ok) throw new Error('No se pudo descargar la foto');
  return r.arrayBuffer();
}

// ── FIREBASE (REST + cuenta de servicio) ─────────────────────
let tokenCache = {token:null, exp:0};

async function googleToken(env){
  if(tokenCache.token && Date.now() < tokenCache.exp - 60_000) return tokenCache.token;
  const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
  const now = Math.floor(Date.now()/1000);
  const enc = o => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const unsigned = enc({alg:'RS256',typ:'JWT'}) + '.' + enc({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600,
  });
  const pem = sa.private_key.replace(/-----[^-]+-----/g,'').replace(/\s+/g,'');
  const der = Uint8Array.from(atob(pem), c=>c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, {name:'RSASSA-PKCS1-v1_5', hash:'SHA-256'}, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const jwt = unsigned + '.' + b64url(new Uint8Array(sig));
  const r = await fetch('https://oauth2.googleapis.com/token',{
    method:'POST', headers:{'content-type':'application/x-www-form-urlencoded'},
    body:`grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const j = await r.json();
  if(!j.access_token) throw new Error('Google OAuth: '+(j.error_description||j.error||r.status));
  tokenCache = {token:j.access_token, exp:Date.now() + j.expires_in*1000};
  return j.access_token;
}

async function fbRaw(env, method, path, body, headers={}){
  const token = await googleToken(env);
  const base = env.FIREBASE_DB_URL.replace(/\/+$/,'');
  return fetch(`${base}/${path}.json?access_token=${encodeURIComponent(token)}`,{
    method, headers:{'content-type':'application/json', ...headers},
    body: body === null || body === undefined ? undefined : JSON.stringify(body),
  });
}

async function fb(env, method, path, body){
  const r = await fbRaw(env, method, path, body);
  if(!r.ok) throw new Error(`Firebase ${r.status}: ${(await r.text()).slice(0,150)}`);
  return r.json();
}

async function fbGetEtag(env, path){
  const r = await fbRaw(env,'GET', path, null, {'X-Firebase-ETag':'true'});
  if(!r.ok) throw new Error(`Firebase ${r.status}: ${(await r.text()).slice(0,150)}`);
  return {value: await r.json(), etag: r.headers.get('ETag')};
}

// ── UTILIDADES ───────────────────────────────────────────────
function round2(n){ return Math.round((+n||0)*100)/100; }

function madridToday(){
  const iso = new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid'}).format(new Date()); // YYYY-MM-DD
  const [y,m] = iso.split('-').map(Number);
  return {iso, y, m:m-1};
}

// Fecha ilegible, futura o de hace más de 90 días → hoy.
function sanitizeDate(s, todayIso){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s||'')) return todayIso;
  const d = Date.parse(s+'T00:00:00Z'), t = Date.parse(todayIso+'T00:00:00Z');
  if(isNaN(d) || d > t + 86400000 || d < t - 90*86400000) return todayIso;
  return s;
}

function toBase64(buf){
  const bytes = new Uint8Array(buf); let s = '';
  for(let i=0; i<bytes.length; i+=0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i+0x8000));
  return btoa(s);
}
function b64url(bytes){
  let s=''; for(let i=0;i<bytes.length;i++) s+=String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
