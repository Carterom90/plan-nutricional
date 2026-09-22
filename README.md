# Plan de Mario

App personal (un solo `index.html`, sin build) para seguir el plan nutricional.

**Plan actual:** ~1800 kcal · 133 g proteína · 191 g hidrato · 57 g grasa. Déficit de 313 kcal/día (~1,2 kg al mes). Plantilla única: no hay ciclado de carbohidratos, los macros son iguales todos los días.

Incluye checklist diario, recetas dinámicas según la rotación de proteínas, guarniciones de verdura, **70 recetas propias** con macros calculados, corte de carne o pescado especificado y todas las cantidades en peso de compra (proteína y verdura en crudo, hidratos en seco, patata cruda pelada, legumbres de bote), el **menú de 6 semanas del nutricionista adaptado** (48 platos, estructura de cocinar cada dos días) y lista de la compra editable.

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

## Una sola fuente: el Menú

El menú de 6 semanas (pestaña **Menú**) es lo único que decide qué se come. **Hoy** muestra el plato del menú para ese día y la **lista de la compra** suma los ingredientes de esos mismos platos, así que las tres cosas siempre coinciden.

La semana del menú se calcula por calendario y avanza sola cada lunes: 1 → 2 → … → 6 → 1. Desde la pestaña Menú se puede fijar cuál es la semana en curso si alguna vez hay que resincronizar.

Los cuatro bloques de cada semana del menú se asignan a los días así: lunes y miércoles, martes y jueves, viernes y sábado, y domingo suelto. Se cocina lunes, martes, viernes y domingo.

El recetario de la pestaña Recetas queda como consulta: técnicas, alternativas y platos para cuando se quiera cambiar algo a mano.

## Pestaña Hoy

Checklist del día con el plato del menú para almuerzo y cena, ingredientes y preparación. La cabecera indica la semana del menú, si hoy toca cocinar o recalentar, y para qué día es la otra mitad.

El aviso de descongelado sale del plato real del día siguiente: indica cada pieza de carne o pescado con su gramaje, duplicado cuando ese día se cocina para dos, y avisa de poner garbanzos en remojo cuando el plato los lleva.

## Pestaña Compra

Se elige el día de la compra y cuánto cubre, con dos modos: **Una semana** (7 días, el habitual) o **Elegir días**, con un selector de 1 a 21 días y accesos rápidos a 2, 3, 4, 5, 10 y 14. La app recuerda el modo y los días elegidos.

**La lista suma lo que se come de verdad en esa ventana.** Para cada día toma el plato del menú que le toca (el mismo que aparece en Hoy y en Menú, con la semana del menú que corresponda a cada día aunque la ventana cruce el domingo), lee sus ingredientes y los agrega, más las tomas fijas multiplicadas por los días. No hay cantidades genéricas: cada producto sale con los gramos, mililitros o unidades que se consumen en ese periodo.

Los ingredientes se normalizan a un nombre de compra ("170 g de pollo en taquitos" y "pechuga de pollo" suman como "Pollo — pechuga"), y las alternativas se respetan ("merluza o rosada" sale como pescado blanco). Lo que va al gusto no entra.

La carne y el pescado que no aguantan toda la ventana en nevera salen en un bloque aparte, **Fresco · congelar al llegar**, con los días en que se usa cada uno.

Al regenerar, los productos automáticos que ya no se usan en la nueva ventana desaparecen, pero las cantidades editadas a mano se conservan.

## Pestaña Progreso

Registro semanal de peso, grasa, masa magra, gasto y calorías activas (Garmin), pasos, sesiones y volumen (Hevy), sueño y frecuencia cardiaca en reposo.

**De dónde salen los datos.** La adherencia se calcula sola a partir de las casillas marcadas en Hoy, sin que haya que introducir nada. El CSV de Hevy se pega tal cual en la caja de importación y la app lo parsea: saca sesiones y volumen de todas las semanas de golpe, descartando las series de calentamiento. El resto (peso, grasa, gasto, pasos, sueño, FC) se importa como bloque JSON, o se teclea a mano en el formulario. Las importaciones se fusionan por fecha, así que el CSV y el JSON pueden llegar por separado sin pisarse.

- Las gráficas son SVG dibujado a mano: sin librerías externas y sin tocar la CSP.
- Cada gráfica usa solo las semanas que tienen su propio dato. Al importar el CSV de Hevy entran semanas con sesiones y volumen pero sin peso ni Garmin; la de peso no las pinta en el eje en vez de mostrar puntos sueltos al final. Si una gráfica no tiene ningún dato, avisa en lugar de dibujarse vacía.
- Selector de periodo: últimas 8, 12 o 26 semanas, o todo el histórico.
- **Proyección**: calcula el ritmo de las últimas semanas y proyecta hasta el 18% y el 15% de grasa. Los pesos objetivo se derivan de la masa magra registrada, no están fijados en el código.
- **Avisos automáticos**: si la FC en reposo sube 4+ pulsaciones sobre la media, o si hay tres semanas seguidas por debajo de 7 h de sueño.
- Los datos van por usuario en Firestore, bajo la clave `progress`.

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
