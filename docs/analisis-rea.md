# Análisis con REA del grabador de Loom

**Objetivo:** entender cómo funciona el grabador de Loom para diseñar una versión local propia.

## Qué se analizó

| | |
|---|---|
| Artefacto | `@loomhq/record-sdk@4.14.5`, descargado de npm con `npm pack` |
| Archivo principal | `dist/esm/index.js` (714 KB, bundle minificado) |
| Herramienta | REA 6.10.1, `analyze_javascript_application` (análisis estático: el código **no se ejecutó**) |
| Evidencia | `ev_db7de8f67c2064505ba27c42262ce5de44f3e7409e1090085a8d33405ae3524c` (resumen: `ev_7d071ce2…`) |
| Cobertura | Parcial. Se analizó 1 de 208 fuentes JS (el bundle ESM); los demás archivos son declaraciones de tipos. Hay 22 484 incógnitas semánticas, sobre todo llamadas dinámicas típicas de código minificado. |

No se pudieron analizar ni la app de escritorio ni la extensión de Chrome: la red del entorno de trabajo bloquea `loom.com` y la Chrome Web Store.

## Observaciones (confirmadas en el código)

1. **El SDK es solo la interfaz.** El bundle no contiene `MediaRecorder` ni `getDisplayMedia`, y tiene 20 referencias a `iframe` y 6 a `postMessage`.
   La captura, la codificación y la subida ocurren en un iframe servido por `loom.com`.
   *Conclusión:* no hay ninguna técnica propietaria imprescindible; con las APIs estándar del navegador o de Electron se puede lograr lo mismo.
2. **Enumeración de dispositivos:** llama a `enumerateDevices()`. Si las etiquetas están vacías, abre `getUserMedia({audio:true, video:true})`, vuelve a enumerar y cierra las pistas.
   → En LoomLocal: `src/renderer/src/devices.ts`.
3. **Medidor de micrófono ("audio glow"):** `getUserMedia({audio:{deviceId:{exact}}})` → `AudioContext` → `BiquadFilter` (paso bajo) → `Gain` → `Analyser` (`minDecibels -90`, `maxDecibels -10`) → se dibuja en un canvas y marca `isThereAnyIssue` cuando no hay nivel.
   → En LoomLocal: `src/renderer/src/components/MicMeter.tsx`.
4. **Estados del grabador** (acciones de Redux → eventos): `start`, `cancel`, `complete`, `recording-complete` y `upload-complete`.
   Las constantes de analítica revelan el flujo completo de la interfaz: cuenta regresiva que se puede saltar, pausa, reanudar, reiniciar (con confirmación), cancelar (con confirmación), terminar, opciones de cámara y micrófono, burbuja arrastrable (`bubble-drag-start`) y un modal de vista previa con título editable, copiar enlace, reiniciar y borrar.
   → En LoomLocal: la barra flotante, el overlay y la vista del video.
5. **Resiliencia:** guarda el estado en IndexedDB (`RESILIENCE_DB_NAME`) con un tiempo de espera, para recuperarse de cierres.
   → En LoomLocal: los fragmentos de `MediaRecorder` se escriben en disco cada segundo (`.webm.part`) y al iniciar se marcan los procesamientos interrumpidos.

## Inferencias y decisiones de diseño (no observadas en Loom)

- En la app de escritorio, la burbuja de cámara es una ventana flotante que la propia captura de pantalla graba, así que no hace falta componer el video. Es lo que hace LoomLocal.
- Compartir es local (servidor HTTP con soporte de Range y un código secreto por video), no en la nube.
- La transcripción usa whisper.cpp en el propio equipo.

## Lo que sigue sin conocerse

- El código real de captura y subida de Loom, que vive en loom.com y no está en el SDK.
- El comportamiento de la app de escritorio nativa: no se pudo descargar.
