# LoomLocal

Grabadora de pantalla y cámara **100 % local y de uso personal**, para macOS y Ubuntu. Funciona sin cuentas, sin nube y sin servidores externos.

- **Grabar:** una pantalla o ventana, la burbuja de cámara (arrastrable, 3 tamaños, circular o redondeada), el micrófono con medidor de nivel y, si quieres, el audio del sistema.
- **Cuenta regresiva**, pausa, reanudar, reiniciar, cancelar y terminar, desde la barra flotante o con atajos.
- **Puntero y marcadores:** resaltado del cursor, ondas en cada clic y marcadores con tiempo durante la grabación, que después sirven como capítulos.
- **Dibujar y señalar:** pluma, resaltador, flecha y rectángulo en 5 colores. Los trazos se desvanecen solos o se quedan fijos.
- **Biblioteca:** búsqueda en títulos, transcripciones y marcadores, título editable, reproductor con capítulos y subtítulos, descarga y borrado.
- **Compartir en tu red:** cada video tiene un enlace con un código secreto, `http://<tu-ip>:4848/v/<código>`, que se abre en el teléfono o en otra computadora conectada a la misma red Wi-Fi.
- **Transcripción con IA local** usando [whisper.cpp](https://github.com/ggml-org/whisper.cpp). Opcionalmente, título y resumen automáticos con [Ollama](https://ollama.com).

Los videos se guardan en `~/LoomLocal/` (`videos/`, `thumbs/`, `captions/` y `library.json`).

## Instalar y ejecutar

Requisitos: Node.js 22 o posterior, git y **macOS 12 Monterey o posterior** (o Ubuntu 22.04 o posterior). La app usa Electron 43, la última versión compatible con Monterey.

```bash
git clone <tu-repo>/loomlocal.git
cd loomlocal
npm install
npm run dev
```

El `npm install` incluye ffmpeg (`ffmpeg-static`). Si no se pudiera descargar, LoomLocal usa el `ffmpeg` del sistema: en Ubuntu, `sudo apt install ffmpeg`; en macOS, `brew install ffmpeg`.

### Crear la app instalable

```bash
npm run dist:mac     # dist/LoomLocal-0.1.0.dmg
```

```bash
npm run dist:linux   # dist/LoomLocal-0.1.0.AppImage y .deb
```

## macOS: permisos

La primera vez, macOS pide permisos en *Ajustes del Sistema → Privacidad y seguridad*:

| Permiso | Para qué |
|---|---|
| Grabación de pantalla (y de audio del sistema) | Grabar la pantalla y el audio del sistema. **Reinicia la app después de activarlo.** |
| Cámara / Micrófono | La burbuja y tu voz |
| Accesibilidad | Solo para “Mostrar clics” |

Mientras usas `npm run dev`, macOS da esos permisos a **la terminal** desde la que la abriste (por ejemplo **iTerm** o **Terminal**): activa la terminal en la lista, ciérrala por completo con ⌘Q y vuelve a abrirla. La app instalada con `npm run dist:mac` aparece como **“LoomLocal”** y tiene un botón **Reiniciar LoomLocal**.
El `.dmg` no está firmado. La primera vez ábrelo con clic derecho → **Abrir**. Cada vez que generes un paquete nuevo, macOS puede volver a pedir el permiso de grabación de pantalla.
El audio del sistema necesita macOS 13 o posterior.

## Ubuntu: notas

- **Wayland** (lo predeterminado en Ubuntu 22.04 y posteriores): al pulsar *Empezar grabación*, el sistema muestra su propio selector de pantalla. Funciona con PipeWire y `xdg-desktop-portal`, que ya vienen instalados.
- En Wayland, el resaltado del cursor y los clics solo se ven sobre las ventanas de la app, porque Wayland no permite leer el cursor global. Para tener todas las funciones, elige **“Ubuntu en Xorg”** en la pantalla de inicio de sesión.
- **Audio del sistema:** marca la casilla y elige la fuente *“Monitor of …”* (PulseAudio/PipeWire).
- En Linux, la barra de controles aparece en el video, porque el sistema no permite excluirla. Arrástrala a una esquina.

## Atajos durante la grabación

| macOS | Ubuntu | Acción |
|---|---|---|
| ⌘⇧P | Ctrl+Shift+P | Pausar o reanudar |
| ⌘⇧S | Ctrl+Shift+S | Terminar |
| ⌘⇧D | Ctrl+Shift+D | Dibujar (Esc para salir) |
| ⌘⇧E | Ctrl+Shift+E | Borrar trazos |
| ⌘⇧M | Ctrl+Shift+M | Agregar marcador |

## Transcripción local con Whisper

1. Instala whisper.cpp:
   - macOS: `brew install whisper-cpp`, que instala `whisper-cli`.
   - Ubuntu:
     ```bash
     git clone https://github.com/ggml-org/whisper.cpp && cd whisper.cpp
     cmake -B build && cmake --build build -j --config Release
     sudo cp build/bin/whisper-cli /usr/local/bin/
     ```
2. Descarga un modelo, por ejemplo `ggml-base.bin` (unos 140 MB; para español conviene `ggml-small.bin`):
   ```bash
   sh ./models/download-ggml-model.sh base
   ```
3. En **Ajustes**, indica la ruta del modelo y pulsa *Probar configuración*.

Cada video se transcribe en segundo plano al terminar la grabación. Los subtítulos aparecen en el reproductor y en el enlace compartido.

**Título y resumen automáticos (opcional):** instala Ollama, ejecuta `ollama pull llama3.2` y activa la opción en Ajustes.

## Cómo funciona

```
Panel principal (renderer)       Proceso principal (Electron)            Ventanas flotantes
──────────────────────────       ────────────────────────────            ──────────────────
getDisplayMedia ──► setDisplayMediaRequestHandler (fuente elegida)
getUserMedia (mic)
AudioContext mezcla audio
MediaRecorder WebM ── 1 s ──► agrega cada fragmento a .webm.part        Burbuja (cámara)
                                                                        Overlay (cuenta regresiva,
              ◄── comandos ── barra / atajos globales ◄──────────────    cursor, clics, dibujo)
terminar ───────────────────► ffmpeg: WebM indexado → miniatura         Barra de controles
                              → MP4 H.264 → whisper.cpp → .vtt
                              Servidor HTTP con Range: /v/<código>
```

- La burbuja y el overlay de dibujo son ventanas reales en pantalla, así que **salen en la grabación sin componer video**.
- La barra usa `setContentProtection`, que la excluye de la captura en macOS.
- Los fragmentos se escriben en disco cada segundo: si la app se cierra de golpe, el video no se pierde por completo.

## Problemas comunes

- **`Error: Electron uninstall` al ejecutar `npm run dev`:** el binario de Electron no se descargó. Ejecuta:
  ```bash
  node -e "require('electron')" && npm run dev
  ```
  Desde la versión 0.1.1, `npm install` lo descarga automáticamente.
- **`Symbol not found: (_OBJC_CLASS_$_SMAppService)` y "Electron se cerró inesperadamente":** tu macOS es anterior al que exige esa versión de Electron. Desde la versión 0.1.2 se usa Electron 43 (macOS 12 o posterior). Actualiza con `git pull && npm install`.
- **`Port 5173 is in use, trying another one…`:** otro servidor de desarrollo usa ese puerto. Es solo un aviso: la app usa el siguiente puerto libre.
- **`Authentication failed` al clonar:** el repo es privado. Inicia sesión con `gh auth login` o clona por SSH: `git clone git@github.com:1nueve/loomlocal.git`.

## Desarrollo

```bash
npm run typecheck
```

```bash
npm test
```

```bash
npm run e2e   # en Linux sin pantalla: xvfb-run -a npm run e2e
```

Las pruebas E2E lanzan Electron, graban con dispositivos simulados (pausa, marcador y dibujo incluidos), comprueban el MP4 en la biblioteca y lo descargan por el enlace. También graban la pantalla real a través del handler de captura.

## Origen

El diseño parte de un análisis con [REA](https://github.com/morluto/rea) del SDK público de grabación de Loom (`@loomhq/record-sdk`, npm). Ver [docs/analisis-rea.md](docs/analisis-rea.md).
LoomLocal es una implementación propia: no contiene código, recursos ni marcas de Loom. Proyecto personal sin relación con Loom ni con Atlassian.
