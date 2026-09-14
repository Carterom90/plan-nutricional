# Plan de Mario

App personal (un solo `index.html`, sin build) para seguir el plan nutricional.

**Plan actual:** ~1800 kcal · 133 g proteína · 191 g hidrato · 57 g grasa. Déficit de 313 kcal/día (~1,2 kg al mes). Plantilla única: no hay ciclado de carbohidratos, los macros son iguales todos los días.

Incluye checklist diario, recetas dinámicas según la rotación de proteínas, guarniciones de verdura, **44 recetas propias** con macros calculados y todas las cantidades pesadas, el **menú de 6 semanas del nutricionista adaptado** (48 platos, estructura de cocinar cada dos días) y lista de la compra editable.

Acceso con **Google Sign-In**, restringido a una única cuenta. Los datos (checklist, lista de la compra, semana de rotación) viven en **Firestore**, privados y sincronizados entre dispositivos.

---

## Puesta en marcha

### 1. Firebase

1. **Authentication → Sign-in method:** habilita *Google*. Deshabilita cualquier otro proveedor que no uses.
2. **Firestore Database:** créala si no existe (`europe-west1`).
3. **Firestore → Rules:** pega `firestore.rules`, **sustituyendo `__ALLOWED_EMAIL__` por tu correo real** (las reglas no pasan por GitHub Actions, se publican a mano). Publica.
4. **Authentication → Settings → Authorized domains:** añade `TUUSUARIO.github.io`. Sin esto el login falla en producción.

### 2. Secretos en GitHub

**Settings → Secrets and variables → Actions.** Crea siete:

| Secreto | Ejemplo |
|---|---|
| `FIREBASE_API_KEY` | `AIza...` |
| `FIREBASE_AUTH_DOMAIN` | `tu-proyecto.firebaseapp.com` |
| `FIREBASE_PROJECT_ID` | `tu-proyecto` |
| `FIREBASE_STORAGE_BUCKET` | `tu-proyecto.appspot.com` |
| `FIREBASE_MESSAGING_SENDER_ID` | `123456789` |
| `FIREBASE_APP_ID` | `1:123...:web:abc...` |
| `ALLOWED_EMAIL` | `tucorreo@gmail.com` |

### 3. Pages

**Settings → Pages → Source: GitHub Actions.** Cada `push` a `main` despliega solo.

---

## Seguridad: cómo está protegido

**Dos capas, y solo una de ellas cuenta de verdad.**

La comprobación del navegador (`ALLOWED_EMAIL` en `index.html`) es comodidad: expulsa a quien entre con otra cuenta de Google y enseña un mensaje claro. Pero es JavaScript en el cliente y **se puede saltar**.

La barrera real son las **reglas de Firestore**, que se aplican en el servidor de Google: comprueban el correo y que esté verificado antes de devolver un solo byte. Aunque alguien abra la consola del navegador y fuerce la app a mostrarse, Firestore le devuelve vacío.

Sin esa restricción por correo, *cualquier persona con una cuenta de Google* podría entrar — Google Sign-In autentica (demuestra quién eres) pero no autoriza (no decide si puedes pasar). Por eso el allowlist no es opcional.

### Ya implementado

- Restricción a una sola cuenta, aplicada en reglas de Firestore (servidor) y en el cliente.
- Se exige `email_verified`.
- Denegación por defecto: todo lo que no sea tu subárbol está bloqueado.
- Límite de tamaño por documento (200 KB) para que una sesión comprometida no infle la base de datos.
- `esc()` sanea todo texto introducido por ti antes de llegar al HTML.
- Content-Security-Policy que limita desde dónde puede cargarse script, estilo y a qué dominios se conecta.
- Secretos fuera del repo, inyectados en el despliegue.

### Recomendado además (fuera del código)

1. **Restringir la API key** en Google Cloud Console → *APIs y servicios → Credenciales*: limita la clave por *referente HTTP* a `https://TUUSUARIO.github.io/*`. Así no sirve desde otro sitio.
2. **Firebase App Check** con reCAPTCHA v3: impide que alguien use tu backend de Firebase desde fuera de tu app. Es la mejora de seguridad con mejor relación esfuerzo/beneficio.
3. **Alertas de presupuesto** en Google Cloud (aunque estés en plan gratuito): te avisa si algo se dispara.
4. **Revisar sesiones** en Firebase → Authentication → Users si alguna vez sospechas.

### Lo que NO protege esto

Si el repo es **público**, el contenido del plan (recetas, macros, objetivos calóricos) es visible para quien encuentre la URL o el repo. Lo que queda tras el login son tus **datos de seguimiento**, no el plan en sí. Si el plan tampoco debe verse, el repo debe ser privado — y entonces GitHub Pages requiere plan Pro.

---

## Actualizar la dieta sin tocar el código

El plan (objetivos, tomas fijas, recetas, rotación, notas) está separado del programa. Al arrancar, la app carga el plan guardado en Firestore y lo aplica sobre el que viene en el código; si no hay ninguno, usa el de fábrica.

Para actualizarlo: **⚙️ Ajustes → Plan de la dieta**, pegar el JSON y pulsar **Importar**. No hace falta editar `index.html`, ni subir nada a GitHub, ni esperar al despliegue.

- **Importar acepta parches parciales.** Si solo cambian los objetivos, basta con enviar `dailyTarget`; el resto del plan se queda como está. Cada importación se fusiona sobre lo que ya hay.
- **Exportar** vuelca el plan completo en el recuadro y lo copia al portapapeles: útil para partir de lo actual al preparar cambios.
- **Restaurar original** vuelve al plan que trae el código.
- Se valida el JSON antes de aplicar nada: si el formato no cuadra, se avisa y no se toca el plan vigente.
- La versión cargada se ve en la propia pantalla de Ajustes.

El código solo se toca cuando cambie la app de verdad (una pestaña nueva, un arreglo), no cuando cambie la dieta.

## Almacenamiento

El adaptador `store` elige solo entre tres niveles:

1. **Firestore** — con sesión iniciada. Modo normal en producción.
2. **`window.storage`** — dentro de Claude.
3. **`localStorage`** — archivo abierto sin Firebase configurado.

Si los placeholders `__FIREBASE_*__` siguen sin sustituir, la app arranca en modo local sin pedir login, así puedes abrir el `index.html` y probar sin montar nada.

## Caché

Service worker *network-first* con versión sellada con el SHA del commit en cada despliegue: los cambios llegan al móvil sin quedarse pillado en una versión vieja.

## Pendiente

`icon-192.png` e `icon-512.png` para que la PWA instalada tenga icono propio.
