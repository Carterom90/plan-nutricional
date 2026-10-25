# Bot de tickets para Balance

Mandas la foto de un ticket a tu bot de Telegram, la IA (Gemini gratis o Claude) lo lee, te lo enseña con botones y, al confirmar, lo apunta en Balance en el mes de la fecha del ticket.

```
📸 Telegram → ☁️ Cloudflare Worker → 🤖 Gemini / Claude → 💾 Firebase → 💰 Balance
```

- Solo responde a tu chat. A cualquier otro le ignora (salvo `/id`, que solo devuelve el ID de quien lo pide).
- Usa las categorías que tenga ese mes en Balance. Si un ticket mezcla cosas, crea una entrada por categoría. Con **🔄 Todo a una categoría** se juntan en una sola.
- También vale una captura de un pago en la app del banco (Revolut, Bizum, tarjeta). Un Bizum a una persona sin concepto va a Otros; los ingresos no se apuntan.
- Si la fecha no se lee, es futura o tiene más de 90 días, usa la de hoy.
- Si tienes la app abierta mientras guarda, no se pisan: relee el mes y vuelve a intentarlo.
- No hace falta tocar la app ni las reglas de Firebase. El bot entra con una cuenta de servicio.

## Puesta en marcha (una sola vez)

### 1. Bot de Telegram
En Telegram, habla con **@BotFather** → `/newbot` → ponle nombre → copia el **token**.

### 2. Clave de la IA (elige una)
- **Gratis: Gemini.** En **aistudio.google.com** → *Get API key* → *Create API key*. No pide tarjeta. Con el nivel gratuito, Google puede usar lo que envías para mejorar sus productos. Para unos tickets al día sobra con el límite gratuito.
- **De pago: Claude.** En **console.anthropic.com** → *API Keys* → *Create key*. Añade algo de saldo en *Billing*. Cada ticket cuesta unos céntimos.

Todo lo demás (Telegram, Cloudflare Workers y Firebase Spark) es gratuito.

### 3. Firebase
- **Configuración del proyecto → Cuentas de servicio → Generar nueva clave privada.** Se descarga un JSON. Trátalo como una contraseña: no lo subas al repo.
- **Realtime Database**: copia la URL de arriba (`https://presupuesto-7e988-default-rtdb.europe-west1.firebasedatabase.app`).

### 4. Cloudflare Worker
1. En **dash.cloudflare.com** (cuenta gratuita) → *Workers & Pages* → *Create* → *Create Worker* → nombre `balance-bot` → *Deploy*.
2. *Edit code*: borra lo que haya, pega `worker.js` → *Deploy*.
3. *Settings → Variables and Secrets* → añade como **Secret**:

| Nombre | Valor |
|---|---|
| `TELEGRAM_TOKEN` | token de BotFather |
| `TELEGRAM_SECRET` | una cadena aleatoria inventada (solo letras, números, `_` y `-`) |
| `GEMINI_API_KEY` **o** `ANTHROPIC_API_KEY` | la clave del paso 2 (si pones las dos, usa Gemini) |
| `FIREBASE_SERVICE_ACCOUNT` | el contenido **entero** del JSON de la cuenta de servicio |
| `FIREBASE_DB_URL` | URL de la Realtime Database |
| `ALLOWED_CHAT_ID` | pon `0` de momento (paso 6) |

Opcionales (como texto normal): `WHO` (nombre que sale en el registro, por defecto `Mario`), `GEMINI_MODEL` (por defecto `gemini-flash-latest`) y `MODEL` para Claude (por defecto `claude-sonnet-5-5`).

### 5. Conectar Telegram con el Worker
Abre en el navegador, sustituyendo los tres valores:

```
https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://balance-bot.<tu-subdominio>.workers.dev&secret_token=<TELEGRAM_SECRET>&allowed_updates=["message","callback_query"]
```

Tiene que responder `"ok":true`.

### 6. Tu chat ID
Escribe `/id` a tu bot, copia el número y ponlo en `ALLOWED_CHAT_ID`. Desde ese momento el bot solo te hace caso a ti.

### 7. Prueba
Mándale la foto de un ticket. Debería contestarte con el resumen y los botones.

## Si algo falla
- **No contesta:** abre `https://api.telegram.org/bot<TOKEN>/getWebhookInfo` y mira `last_error_message`.
- **Errores dentro del Worker:** *Workers → balance-bot → Logs* (activa *Real-time logs*).
- **"Google OAuth" o "Firebase 401":** el JSON de la cuenta de servicio está mal pegado o la URL de la base de datos es otra.
- **"Gemini 404":** ese nombre de modelo ya no existe. Mira en AI Studio qué modelo Flash gratuito hay y ponlo en `GEMINI_MODEL`.
- **"límite gratuito de Gemini":** has gastado la cuota del día. Se renueva sola.
- **La foto no se lee bien:** mándala como foto (no como archivo), con el ticket entero y buena luz.
