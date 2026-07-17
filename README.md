# INTEL.DOM.GOV RAG

**Plataforma de Inteligencia Gubernamental (Government Intelligence Platform) con Deep Research para el Estado Dominicano.**

---

## ¿Qué es?

**INTEL.DOM.GOV RAG** es una plataforma de inteligencia estatal impulsada por IA que realiza *deep research* en tiempo real sobre las fuentes oficiales de la **República Dominicana**. No es un chatbot convencional: cada consulta dispara un **bucle multiagente de recuperación y razonamiento** que busca, lee, contrasta y sintetiza información oficial antes de responder. La IA no contesta de memoria: construye la respuesta a partir de las fuentes oficiales recuperadas.

La plataforma cubre los tres poderes del Estado y los organismos de transparencia:

- **Poder Legislativo** — Cámara de Diputados, Senado de la República, SIL de Iniciativas.
- **Poder Ejecutivo** — Presidencia de la República, Consultoría Jurídica del Poder Ejecutivo.
- **Poder Judicial** — Tribunal Constitucional.
- **Transparencia y Datos** — DGCP (Contrataciones Públicas), Datos Abiertos RD.

---

## Dos flujos paralelos (FUENTES)

El resultado se presenta en dos vertientes claramente separadas y visualizadas:

### FLUJO A · Fuentes institucionales oficiales (primario)
Recuperación en vivo desde los portales del Estado Dominicano:

| Institución | Tipo | Secciones clave |
|-------------|------|-----------------|
| Cámara de Diputados | Legislativo | Iniciativas, Sesiones del Pleno, Debates, Vistas Públicas, Órdenes del Día, Actas, Transparencia |
| Senado de la República | Legislativo | Iniciativas, Iniciativas Aprobadas, Orden del Día, Actas, Comisiones |
| Diputados SIL (API) | Legislativo | Iniciativas/Leyes (API), Comisiones (API), Sesiones (API) |
| Presidencia de la República | Ejecutivo | Noticias, Decretos/Gaceta, Transparencia |
| Consultoría Jurídica | Ejecutivo | Noticias, Consulta Jurídica |
| Tribunal Constitucional | Judicial | Sala de Prensa, Jurisprudencia/Decisiones, **Sentencias (buscador)** |
| DGCP (Contrataciones) | Transparencia | Leyes, Decretos, Resoluciones, Publicaciones |
| Datos Abiertos RD | Transparencia | Catálogo de Datasets |

### FLUJO B · Cobertura en noticias / medios (secundario)
- Secciones de noticias de los portales oficiales.
- Medios dominicanos (Diario Libre, Listín Diario, Hoy, El Caribe).

---

## Cómo funciona (arquitectura)

```
        Usuario
           │
           ▼
   Planificador / Orquestador
           │
   ┌───────┼────────────┐
   ▼       ▼            ▼
Agente  Agente        Agente
Búsqueda Institución  Recuperación
   │       │            │
   └───────┼────────────┘
           ▼
  Fuentes oficiales .do
  (Legislativo, Ejecutivo, Judicial, Transparencia)
           ▼
   Extracción de evidencia
           ▼
   Agente de Validación
           ▼
   Agente de Refinamiento
           ▼
   Generador de Respuesta (con citas)
           ▼
        Usuario
```

### Bucle de agentes por consulta

1. **Planner** — entiende la intención y decide instituciones y estrategia.
2. **Institution** — acota a los portales oficiales relevantes.
3. **Search** — formula las búsquedas (SearXNG + APIs oficiales).
4. **Retrieval** — descarga y extrae el texto de las fuentes oficiales.
5. **Evidence** — extrae hechos, fechas, leyes, decretos y resoluciones.
6. **Validation** — detecta contradicciones, duplicados y falta de información.
7. **Refinement** — sintetiza y elimina ruido.
8. **Response** — genera el análisis con citas verificables.

Todo el proceso es **impulsado por la consulta** y **stateless**: no hay crawling continuo ni base de conocimiento persistente.

---

## Árbol de URLs y filtrado por selección

El panel **Árbol de URLs** permite seleccionar exactamente de qué fuentes recuperar:

- Por defecto, la búsqueda abarca **todas** las instituciones del Estado.
- Si se selecciona **cualquier** fuente (portal o sección), el sistema **filtra los resultados antes de pasarlos a la IA**, de modo que la respuesta se basa únicamente en la información filtrada.
- La selección puede hacerse a nivel de portal o de sección (p. ej. solo "Decretos" de Presidencia, o solo "Jurisprudencia" del Tribunal Constitucional).

---

## Matriz de Evidencia Extraída

Cada respuesta incluye una **MATRIZ DE EVIDENCIA** con trazabilidad directa a las fuentes oficiales:

- Hecho / declaración clave.
- Institución responsable.
- Fecha de publicación.
- Enlace al documento oficial.
- Nivel de confianza (Alto / Medio / Bajo).

---

## Agentes de recuperación (fuentes reales)

| Fuente | Método | Estado |
|--------|--------|--------|
| Cámara de Diputados — secciones | HTTP directo | ✅ Activo |
| Senado de la República | HTTP directo | ✅ Activo |
| Diputados SIL — API JSON | API en vivo | ✅ Activo |
| Presidencia de la República | HTTP directo | ✅ Activo |
| Consultoría Jurídica | HTTP directo | ✅ Activo |
| Tribunal Constitucional | HTTP directo | ✅ Activo |
| Tribunal Constitucional — Sentencias | Buscador AJAX `?searchString=<KEYTERM>` (requiere header `X-Requested-With: XMLHttpRequest`) | ✅ Activo |
| DGCP (Contrataciones Públicas) | HTTP directo | ✅ Activo |
| Datos Abiertos RD | CKAN API | ✅ Activo |
| Medios dominicanos | HTTP directo | ✅ Activo |
| SearXNG (búsqueda web) | Instancia local `127.0.0.1:8090` | ✅ Activo |

---

## Reglas de razonamiento

La IA debe:

- Razonar **solo** sobre la evidencia recuperada.
- Nunca inventar fuentes, números de ley, decretos ni fechas.
- Cubrir el **Estado Dominicano** en su conjunto: Legislativo, Ejecutivo, Judicial y Transparencia.
- Citar la URL oficial exacta de cada hecho.
- Mantener la confianza baja si las fuentes son insuficientes.

---

## Requisitos y configuración

- **Node.js** + TypeScript.
- Instancia de **SearXNG** local (ver `searxng-docker-compose.yml` y `searxng/settings.yml`) expuesta en `127.0.0.1:8090`.
- **API key de Gemini** configurada en el panel de Ajustes (o variable `GEMINI_API_KEY`).
- Variables en `.env`: `SEARXNG_URL=http://127.0.0.1:8090`.

### Puesta en marcha

```bash
# Servidor de búsqueda SearXNG
docker compose -f searxng-docker-compose.yml up -d

# Aplicación
cd Apps/ChatGobDO
npm install
npm run dev
```

---

## Modelos soportados

Proveedores configurables (Gemini / OpenAI / Anthropic). Modelo Gemini por defecto: **gemini-3.1-flash-lite**. La lista completa está en el panel de Ajustes (IA / Modelo).

---

## Objetivo de diseño

El sistema debe sentirse menos como un chatbot y más como un **analista de inteligencia gubernamental** del Estado Dominicano. Cada respuesta debe ser:

- precisa,
- basada en evidencia oficial,
- reproducible,
- transparente,
- fácil de verificar.

La IA no "sabe" la respuesta de antemano: la **construye** recuperando, validando y sintetizando información oficial del Estado Dominicano en tiempo real.
