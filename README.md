# Plan de Mario

App personal (un solo `index.html`, sin build) para seguir el plan nutricional.

**Plan actual:** ~1800 kcal · 133 g proteína · 191 g hidrato · 57 g grasa. Déficit de 313 kcal/día (~1,2 kg al mes). Plantilla única: no hay ciclado de carbohidratos, los macros son iguales todos los días.

Incluye checklist diario, recetas dinámicas según la rotación de proteínas, guarniciones de verdura, **78 recetas propias** con macros calculados, corte de carne o pescado especificado y todas las cantidades en peso de compra (proteína y verdura en crudo, hidratos en seco, patata cruda pelada, legumbres de bote), el **menú de 6 semanas del nutricionista adaptado** (48 platos, estructura de cocinar cada dos días) y lista de la compra editable.

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

Son **48 platos distintos en 48 huecos**: ningún plato se repite dentro del ciclo de seis semanas.

La semana del menú se calcula por calendario y avanza sola cada lunes: 1 → 2 → … → 6 → 1.

**El menú va cerrado (estanco).** Desde la app no se puede re-anclar el ciclo: se diseña por periodos de cuatro meses y, entre medias, solo se consulta. En la pestaña Menú se pueden mirar las seis semanas, pero si abres una que no es la que toca, la app avisa de que la que manda es la del calendario. La función `fijarSemanaMenu()` sigue en el código, sin botón que la llame, para recolocar el ciclo cuando se diseñe un periodo nuevo.

Los cuatro bloques de cada semana del menú se asignan a los días así: lunes y miércoles, martes y jueves, viernes y sábado, y domingo suelto. Se cocina lunes, martes, viernes y domingo.

**Cómo cocinas (Ajustes → Cómo cocinas).** Dos modos, y el menú es el mismo en los dos: el plato se repite los dos días de su bloque, así que la compra no cambia.

- **Al momento, cada día** (por defecto). Las dos comidas se hacen el mismo día que se comen. Hoy nunca dice de cocinar el doble ni de recalentar, y el aviso de descongelado salta **las siete noches**, con ración sencilla.
- **En tandas de dos días.** Se cocina lunes, martes, viernes y domingo, el doble, y el segundo día se recalienta. El aviso de descongelado salta solo las cuatro noches previas a un día de cocina, con la ración doblada.

El modo se guarda con el resto de ajustes y vive en `settings.modoCocina` (`'diario'` o `'tandas'`). Lo controlan tres funciones — `cocinaDiaria()`, `esDiaDeCocina()` y `idxParejaDe()` —, así que todo lo demás (Hoy, el aviso de descongelado, el Menú) se adapta solo.

Cocinando al momento da igual que un plato aguante o no, así que los revueltos, las tortillas y la plancha pueden ir cualquier día.

**Bloques partidos (sin usar ahora mismo).** Un hueco del bloque (`alm` o `cena`) admite, además de un plato único, un par `[día 1, día 2]`: dos platos distintos, cada uno hecho al momento. Está para cuando se cocine en tandas y un plato no aguante recalentado. Hoy lo marca como «al momento» y puede decir «hoy solo cocinas la cena»; el Menú muestra los dos platos con el día delante; el aviso de descongelado no dobla la ración y la pide la noche antes del día que toca. Al importar un plan se valida que cada hueco sea un plato o un par de platos.

El recetario de la pestaña Recetas queda como consulta: técnicas, alternativas y platos para cuando se quiera cambiar algo a mano.

## Elaboración de los platos

Los **126 platos** (48 del menú y 78 del recetario) llevan la preparación en pasos numerados, con el orden de los ingredientes, el tiempo y el método de cada paso. Son 636 pasos en total, una media de 5 por plato.

En el menú, el campo `p` de cada plato admite dos formas: un texto suelto o una **lista de pasos**. `pasosDe()` normaliza las dos, así que Hoy y Menú pintan una lista numerada sin tener que saber cuál es. Al importar un plan se valida que `p` sea texto o lista de textos.

Los pasos los redactó Claude a partir de los ingredientes, los gramajes y los aparatos disponibles (plancha, air fryer, olla express), igual que el resto del recetario: no proceden del material original del nutricionista, que nunca incluyó elaboración.

## Pestaña Hoy

Checklist del día con el plato del menú para almuerzo y cena, ingredientes y preparación. La cabecera indica la semana del menú, si hoy toca cocinar o recalentar, y para qué día es la otra mitad.

El aviso de descongelado sale del plato real del día siguiente: agrupa por producto y da el gramaje total a sacar, duplicado solo cuando ese plato cubre los dos días del bloque, y avisa de poner garbanzos en remojo cuando el plato los lleva. Si mañana esa comida se recalienta, no pide nada por ella; cocinando al momento, salta todas las noches.

**Pechugas enteras.** Se congelan enteras y, descongeladas, solo aguantan un día en crudo. Cuando el día siguiente lleva pechuga, el aviso recuerda descongelar la pieza completa y cocinarla entera: hecha aguanta dos días, así que el resto queda listo para la comida siguiente. El aviso no salta con pollo picado ni con fiambre, que no vienen en piezas.

## Los hidratos

El hidrato ya no es patata por defecto. Seis bases rotan por el menú — arroz, cuscús, patata, noodle fresco, ñoquis y boniato — y **ningún día repite hidrato entre la comida y la cena**. En el menú de 6 semanas quedan 14 platos con patata de 48, frente a los 38 de antes.

La patata se mantiene solo donde **es** el plato: guisos y estofados, marmitako, papas con choco, el choco a la gallega, los salpicones, ensalada campera, tortilla de patata, gazpachuelo, las cremas (donde hace de espesante) y los pescados al horno en láminas. En el resto era relleno y se cambió.

Las seis bases son intercambiables en cualquier receta; estas cantidades aportan los mismos 20 g de hidrato:

| Base | Cantidad |
|---|---|
| Patata cruda pelada | 100 g |
| Arroz en seco | 25 g |
| Cuscús en seco | 28 g |
| Noodle fresco | 65 g |
| Ñoquis frescos | 60 g |
| Boniato crudo pelado | 100 g |

Los macros se mueven 1-2 g de proteína como mucho.

## Envases: que no sobre nada

Un criterio que atraviesa todo el menú: **la ración es una fracción exacta del envase, y los platos que comparten un producto caen en la misma semana**, de modo que se abre, se gasta y no queda medio bote en la nevera.

Ojo al calcularlo, porque es la trampa fácil: **cada bloque del menú se come dos días**, así que un almuerzo de 100 g consume 200 g a la semana, y una cena de 62,5 g consume 125.

| Producto | Envase | Ración | Dónde se acaba |
|---|---|---|---|
| Noodles frescos | 200 g | 100 g almuerzo · 50 g cena | Semanas 2 y 3, 200 g exactos cada una |
| Ñoquis frescos | 500 g | 100 g almuerzo · 50 g cena | Semana 1, los tres platos juntos |
| Queso fresco de Burgos | Tarrina de 250 g | 62,5 g por cena | Semana 2, dos cenas = tarrina entera |
| Mejillones al natural | Lata de 111 g netos (69 escurridos) | 2 latas almuerzo · 1 cena | Semana 6, latas enteras |
| Avena en copos | 500 g | 70 g al día | 490 g por semana |

Lo que va congelado (calamar, choco, guisantes, pechugas) o es seco o curado (arroz, cuscús, pasta, parmesano, frutos secos) no necesita cuadrar: se saca la ración y el resto aguanta.

**Lo que se quitó por este motivo**, no por gusto: aguacate (se oxida en un día y entraba a 20-40 g), maíz dulce (lata abierta) y burrata (la unidad entera son 100 g y 20 g de grasa, más de lo que lleva una cena completa).

**Fuera también el pulpo, por precio** (25-30 €/kg). Lo sustituyen anillas de calamar y choco en los platos calientes, y mejillones al natural de lata en los dos salpicones. En macros es casi un cambio uno a uno (pulpo 15 g de proteína por 100 g, calamar y choco 16), pero **la cocción cambia del todo**: el pulpo venía cocido y solo había que calentarlo, mientras que el calamar y el choco van crudos y solo admiten dos tiempos, 2-3 minutos a fuego muy fuerte o 30-40 guisados. Lo de en medio sale gomoso.

## Pestaña Envases

Tabla de consulta con los formatos de Mercadona, en cuatro bloques: lo que **cuadra exacto**, lo que **no tiene riesgo** de ponerse malo (congelado y seco), lo que **sobra** del envase, y los formatos **pendientes de confirmar**, con lo que se gasta por semana al lado para mirarlo en el súper.

Los datos viven en `envases` y viajan en el JSON del plan, así que se actualizan por importación, sin tocar el código.

## Ritmo de trabajo

El plan se revisa **cada cuatro meses**, en noviembre, marzo y julio:

- **Primer miércoles del mes del ciclo** — se diseña el menú del periodo siguiente y se pasan los pesos de báscula y las mediciones de Garmin.
- **Tercer miércoles** — revisión de peso y mediciones, dos semanas después.

Hay aviso en Google Calendar el martes anterior a las 21:00 («Mañana toca pesarte»), como dos eventos recurrentes cuatrimestrales.

## Pestaña Compra

Se elige el día de la compra y cuánto cubre, con dos modos: **Una semana** (7 días, el habitual) o **Elegir días**, con un selector de 1 a 21 días y accesos rápidos a 2, 3, 4, 5, 10 y 14. La app recuerda el modo y los días elegidos.

**La lista suma lo que se come de verdad en esa ventana.** Para cada día toma el plato del menú que le toca (el mismo que aparece en Hoy y en Menú, con la semana del menú que corresponda a cada día aunque la ventana cruce el domingo), lee sus ingredientes y los agrega, más las tomas fijas multiplicadas por los días. No hay cantidades genéricas: cada producto sale con los gramos, mililitros o unidades que se consumen en ese periodo.

Los ingredientes se normalizan a un nombre de compra ("170 g de pollo en taquitos" y "pechuga de pollo" suman como "Pollo — pechuga"), y las alternativas se respetan ("merluza o rosada" sale como pescado blanco). Cuando la alternativa va entre paréntesis manda el ingrediente principal: "dorada (o salmón)" se compra dorada. Lo que va al gusto no entra.

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

- Formatos de envase sin confirmar: ternera picada, pescado, gambas, atún, tomate triturado, caldo, leche evaporada, yogur y chocolate. Están listados en la pestaña Envases con lo que se gasta por semana.
- Sobras conocidas que no cuadran con el envase: las claras en la semana 4 (80 ml de una botella de 300), el fiambre de pavo (200 g de 225), el jamón (40 g de ~75) y las verduras que entran a media pieza.
- `icon-192.png` e `icon-512.png` para que la PWA instalada tenga icono propio.
