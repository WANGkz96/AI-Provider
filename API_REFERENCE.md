# API Reference

Это единый справочник API локального AI провайдера.
Сервер унифицирует работу с различными моделями (Google, OpenAI, Local Docker), предоставляя единый интерфейс.

## Base URL
`http://localhost:3000`

---

## Endpoints

### 1. Health Check
Проверка работоспособности сервера.

- **GET** `/health`
- **Response**:
  ```json
  {
    "status": "ok",
    "timestamp": "2026-01-06T12:00:00.000Z"
  }
  ```

### 2. Available Models
Список доступных и сконфигурированных моделей.

- **GET** `/available-models`
- **Response**:
  ```json
  {
    "models": [
      {
        "id": "gemma-4-31b-it",
        "provider": "google",
        "available": true,
        "type": "cloud"
      },
      {
        "id": "gemini-3.1-flash-lite",
        "provider": "google",
        "available": true,
        "type": "cloud",
        "aliases": [
          "models/gemini-3.1-flash-lite",
          "gemini-3.1-flash-lite-preview",
          "models/gemini-3.1-flash-lite-preview"
        ]
      }
    ]
  }
  ```

Model aliases are accepted by `/run` but `/available-models` returns the canonical
model id for the active Google mode. For example, `gemini-3.1-flash-lite-preview`
and `models/gemini-3.1-flash-lite-preview` resolve to `gemini-3.1-flash-lite`;
`gemma-4` resolves to the configured Gemma 4 26B model for the current mode.

### 3. Run Inference
Основной метод запуска генерации. Поддерживает стриминг (SSE) и обычный JSON ответ.

- **POST** `/run`
- **Content-Type**: `application/json`
- **Request size limit**: по умолчанию `300mb` (настраивается через `REQUEST_BODY_LIMIT`)
- Для `media[].data` учитывайте overhead base64: файл `134 MB` превращается примерно в `179 MB` JSON payload.

#### Parameters

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `model` | string | **Yes** | ID модели (из списка `/available-models`) |
| `messages` | array | No | История чата (для text моделей). |
| `prompt` | string | No | Прямой текст запроса (подходит для audio/image). |
| `media` | array | No | **(New)** Вложения для text-запроса (картинки/видео/аудио). Сейчас обработка поддержана для Gemini text моделей. |
| `stream` | boolean | No | Включить стриминг ответов (SSE). Default: `false`. Для обычного text streaming сервер может слать отдельные SSE payload fields `content`, `thought` и финальный `provider_state`. |
| `temperature` | number | No | Креативность / sampling temperature (0.0 - 2.0). Отправляется в поддерживающие модели, включая Vertex Gemini text generation. |
| `topP` | number | No | Nucleus sampling (0.0 - 1.0). |
| `maxTokens` | number | No | Максимальное количество токенов в ответе. Aliases: `max_tokens`, `maxOutputTokens`, `max_output_tokens`. Если поле не передано, сервер использует свой default budget. |
| `thinking` | object | No | **(New)** Настройки мышления (Reasoning). Для Gemini 3 / 3.1 используйте `thinking.level`, для Gemini 2.5 и старее `thinking.budget`. |
| `responseJsonSchema` | object | No | Legacy/compat structured-output field for Gemini JSON schema requests. |
| `tts` | object | No | **(New)** Настройки Text-to-Speech для моделей `type=audio` (Chatterbox / Gemini TTS). |
| `image` | object | No | **(New)** Параметры генерации изображений. |
| `video` | object | No | **(New)** Параметры генерации видео. |

#### Eco Routing

Eco routing is enabled only when the server has `ECO_ENABLED=true`, global Google mode is
Vertex, and `GOOGLE_AI_STUDIO_API_KEY` is configured. Add the optional request field
`"eco": true` to try AI Studio Free Tier first. Requests for non-Google providers ignore it.

The router checks AI Studio model availability, reserves local RPM/RPD/TPM quota, waits for a
short RPM window when possible, and otherwise uses the normal Vertex request. A successful AI
Studio response is recorded as free; a Vertex fallback remains billable. The persistent
`data/eco-quota.json` ledger contains only timestamps, canonical model ids, reservation status
and token counters, never prompts, keys or response text.

Eco streaming is buffered until the provider decision is complete. The SSE shape remains the
same, but the first content event is not realtime. Structured output, function calling,
provider state/chaining and `maxTokens` use the same request fields in both routes.

Text responses expose `metadata.provider.ecoRouting`; media responses expose
`metadata.ecoRouting`. The metadata includes the actual route, fallback reason, attempts and a
quota snapshot. Unknown quota profiles use Vertex until monitoring provides a usable profile.

`use_fallback: "auto"` keeps fallback models inside the same media group. For image requests,
`gemini-3.1-flash-lite-image` falls back to `gemini-3.1-flash-image` and then
`gemini-3-pro-image`. These image-generation models currently have no Gemini API Free Tier, so
`eco: true` remains valid but routes them through Vertex. If the requested paid image route
returns `429 RESOURCE_EXHAUSTED`, the provider tries the compatible image fallbacks and reports
the model that actually succeeded in the top-level `model` field. If every route is exhausted,
`/run` returns HTTP 429 with `Retry-After`, `retryAfter` and `retryAfterSeconds`.

`GET /eco/status` returns the local ledger state, AI Studio availability, per-model RPM/RPD/TPM
usage and remaining counters, the next RPM reset, the next Pacific daily reset, and Monitoring
status. It requires the same access key as the other protected endpoints.

`GET /usage-costs` exposes `summary.actualVertexUsd` for measured Vertex spend,
`summary.ecoSavedUsd` for the Vertex-equivalent value of successful Free Tier requests,
`summary.ecoFreeRequestCount`, `summary.vertexRequestCount` and `summary.ecoFallbackCount`.

#### Message Object
```json
{
  "role": "user" | "assistant" | "system",
  "content": "Текст сообщения"
}
```

#### 2026 Update: Thinking Parameters

Use these shapes for `thinking`:

Gemini 3 / 3.1:

```json
{
  "thinking": {
    "level": "HIGH",
    "includeThoughts": true
  }
}
```

Gemini 2.5 and earlier:

```json
{
  "thinking": {
    "budget": 4096,
    "includeThoughts": true
  }
}
```

Notes:

- `thinking.level` is supported by `/run` for Gemini 3 / 3.1: `MINIMAL`, `LOW`, `MEDIUM`, `HIGH`.
- `thinking.budget` is still accepted for Gemini 2.5 and earlier.
- `temperature`, `topP`, and `maxTokens` / `max_tokens` / `maxOutputTokens` / `max_output_tokens` continue to work independently of `thinking`.
- `includeThoughts` enables provider-native thought summaries when the model returns them.

#### Advanced Agent Fields
For Deep Research and other agent-style clients, `/run` also supports optional OpenAI-like fields for structured output and tool calling.

Request additions:

```json
{
  "max_tokens": 8192,
  "output": {
    "type": "json_schema",
    "name": "Summary",
    "schema": {
      "type": "object",
      "properties": {
        "summary": { "type": "string" },
        "key_excerpts": { "type": "string" }
      },
      "required": ["summary", "key_excerpts"]
    }
  },
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "ConductResearch",
        "description": "Call this tool to conduct research on a specific topic.",
        "parameters": {
          "type": "object",
          "properties": {
            "research_topic": { "type": "string" }
          },
          "required": ["research_topic"]
        }
      }
    }
  ],
  "tool_choice": "auto"
}
```

Supported text message roles:

```json
{ "role": "system", "content": "..." }
{ "role": "user", "content": "..." }
{ "role": "assistant", "content": "", "tool_calls": [{ "id": "call_1", "name": "ConductResearch", "arguments": { "research_topic": "..." } }] }
{ "role": "tool", "tool_call_id": "call_1", "content": "{\"result\":\"...\"}" }
```

Text responses keep the legacy fields and also include agent-friendly fields:

```json
{
  "type": "text",
  "content": "",
  "message": {
    "role": "assistant",
    "content": "",
    "parts": [
      {
        "functionCall": {
          "name": "ConductResearch",
          "args": {
            "research_topic": "..."
          }
        },
        "thoughtSignature": "<opaque>"
      }
    ],
    "provider_state": {
      "role": "model",
      "parts": [
        {
          "functionCall": {
            "name": "ConductResearch",
            "args": {
              "research_topic": "..."
            }
          },
          "thoughtSignature": "<opaque>"
        }
      ]
    },
    "tool_calls": [
      {
        "id": "call_1",
        "name": "ConductResearch",
        "arguments": {
          "research_topic": "..."
        },
        "provider_state": {
          "role": "model",
          "parts": [
            {
              "functionCall": {
                "name": "ConductResearch",
                "args": {
                  "research_topic": "..."
                }
              },
              "thoughtSignature": "<opaque>"
            }
          ]
        }
      }
    ]
  },
  "output_text": "",
  "parsed_output": null
}
```

Notes:
- All new fields are optional.
- Existing requests with `maxTokens` or its aliases, plain `messages`, `prompt`, and legacy `responseMimeType` / `responseSchema` / `responseJsonSchema` continue to work.
- For Gemini 3 multi-step tool calling, send `message.parts`, `message.provider_state.parts`, or the returned `tool_calls[].provider_state` back exactly as received from the previous assistant response so thought signatures are preserved.
- `stream: false` is required when using `output`, `tools`, `tool_choice`, assistant `tool_calls`, or `tool` messages.
- If the client omits `maxTokens` and its aliases, `/run` uses the server default budget (`DEFAULT_GENERATION_TOKENS`, legacy alias `MAX_GENERATION_TOKENS`). If `MAX_GENERATION_TOKENS_HARD_CAP` is set, `/run` clamps the final budget to that hard cap and exposes `requestedMaxTokens`, `defaultMaxTokens`, `appliedMaxTokens`, and `hardCapMaxTokens` in response metadata.

#### 2026 Update: Streaming Thought/Content Payloads

For plain text streaming, `/run` now emits SSE frames with structured payloads instead of forcing a single mixed text stream:

```json
{ "content": "..." }
{ "thought": "..." }
{ "provider_state": { "role": "model", "parts": [] } }
```

The stream terminates with:

```text
data: [DONE]
```

Frontend migration from old `<think>...</think>` parsing:

- Stop extracting thought text from a single tagged text stream.
- Read `content` and `thought` as separate SSE payload fields.
- Persist the final assistant `provider_state` in chat history.
- Send that same `provider_state` back in the next `/run` request for the assistant turn.
- For non-streaming responses, prefer `message.parts` / `message.provider_state` over reconstructing provider state from plain text.

#### Media Object (New)
Единый формат вложений для `/run`. Передаётся как массив `media`.

```json
[
  {
    "type": "image",               // optional: image | video | audio (если не передан, определяется по mimeType)
    "mimeType": "image/jpeg",      // обязателен
    "data": "<base64>",            // обязателен (можно с/без data:*;base64, префикса)
    "name": "frame.jpg",           // optional
    "videoMetadata": {             // optional, только для video
      "startOffset": "40s",
      "endOffset": "80s",
      "fps": 5
    }
  }
]
```

Поддерживаемые типы сейчас:
- `image/*` -> отправляется в Gemini как `inlineData`
- `video/*` -> загружается через Gemini Files API, затем ждётся состояние `ACTIVE`
- `audio/*` -> загружается через Gemini Files API, затем ждётся состояние `ACTIVE`

#### Thinking Object (New)
Используется только для моделей с поддержкой Reasoning (например, `gemini-3-flash-preview`).

```json
{
  "budget": number,      // Бюджет токенов на мышление (минимум 1024, если поддерживается)
  "includeThoughts": boolean // Возвращать ли процесс мышления в ответе
}
```

#### TTS and Music Audio Object (New)
Используется для моделей `type=audio`.

Для Chatterbox:
```json
{
  "languageId": "ru",
  "voiceSample": "voice.wav",
  "exaggeration": 0.5,
  "cfg": 0.5
}
```

Для Gemini TTS (single speaker):
```json
{
  "mode": "single",
  "voiceName": "Kore"
}
```

Для Gemini TTS (multi speaker):
```json
{
  "mode": "multi",
  "speakers": [
    { "speaker": "Joe", "voiceName": "Kore" },
    { "speaker": "Jane", "voiceName": "Puck" }
  ]
}
```

#### Lyria 3 Music

Use `lyria-3-clip-preview` for a 30-second clip or `lyria-3-pro-preview` for a full song. Send a `prompt` directly; the `tts` object is not required. Image references can be supplied through `media`.

Lyria responses return MP3 audio in `audio.mimeType` and generated lyric or structure text in `lyrics` and `metadata.lyrics`.

#### Image Object (New)
Используется для image моделей (Imagen и Nano Banana).

```json
{
  "size": "1K",            // Опционально: 1K, 2K
  "aspectRatio": "9:16",   // Опционально: 1:1, 4:3, 3:4, 16:9, 9:16
  "count": 1,              // Только для Imagen (1-4)
  "format": "image/png"    // Только для Imagen: image/png или image/jpeg
}
```

#### 2026 Update: Nano Banana Conversational Mode

Nano Banana can now use multi-turn conversation history through `/run`.

Request pattern:

- Send `messages[]` instead of only `prompt`.
- User turns can include text and image `parts`.
- Assistant image turns return `message.parts` and `provider_state`.
- Send that assistant `provider_state` back on the next turn so the model sees its previous generated images.

Minimal request shape:

```json
{
  "model": "gemini-3-pro-image-preview",
  "messages": [
    {
      "role": "user",
      "content": "Create a mascot in flat illustration style.",
      "parts": [
        { "text": "Create a mascot in flat illustration style." }
      ]
    },
    {
      "role": "assistant",
      "content": "",
      "provider_state": {
        "role": "model",
        "parts": [
          { "inlineData": { "mimeType": "image/png", "data": "<base64>" } }
        ]
      }
    },
    {
      "role": "user",
      "content": "Keep the character, but change the background to orange."
    }
  ],
  "image": {
    "size": "1K",
    "aspectRatio": "1:1"
  },
  "stream": false
}
```

Response additions for Nano Banana:

```json
{
  "type": "image",
  "images": [
    { "data": "<base64>", "mimeType": "image/png" }
  ],
  "message": {
    "role": "assistant",
    "content": "",
    "parts": [],
    "provider_state": {
      "role": "model",
      "parts": []
    }
  },
  "provider_state": {
    "role": "model",
    "parts": []
  }
}
```

#### Video Object (New)
Используется для video моделей (Veo).

```json
{
  "aspectRatio": "16:9",     // Опционально: 16:9, 9:16, 1:1, 4:3, 3:4
  "durationSeconds": 8,      // Опционально: длительность видео
  "resolution": "1080p",     // Опционально: 720p, 1080p
  "count": 1                 // Опционально: количество видео (1-4)
}
```

#### Example Request (Gemini 3 Thinking + Stream)
```json
{
  "model": "gemini-3.1-flash-lite",
  "messages": [
    { "role": "system", "content": "You are a careful assistant." },
    { "role": "user", "content": "Solve this step by step and explain the final answer clearly." }
  ],
  "stream": true,
  "temperature": 1.2,
  "topP": 0.95,
  "maxTokens": 4096,
  "thinking": {
    "level": "HIGH",
    "includeThoughts": true
  }
}
```

#### Example Request
```json
{
  "model": "gemini-3-flash-preview",
  "messages": [
    { "role": "system", "content": "Ты полезный ассистент." },
    { "role": "user", "content": "Реши сложную логическую задачу..." }
  ],
  "stream": true,
  "thinking": {
    "budget": 2048,
    "includeThoughts": true
  }
}
```

#### Example Request (Text + Media, Gemini)
```json
{
  "model": "gemini-3-flash-preview",
  "messages": [
    { "role": "user", "content": "Опиши видео и укажи таймкоды ключевых моментов." }
  ],
  "media": [
    {
      "type": "video",
      "mimeType": "video/mp4",
      "name": "sample.mp4",
      "data": "<base64>",
      "videoMetadata": {
        "fps": 5
      }
    }
  ],
  "stream": false
}
```

#### Example Request (Audio Attachment, Gemini)
```json
{
  "model": "gemini-3-flash-preview",
  "messages": [
    { "role": "user", "content": "Опиши этот аудиофрагмент и выдели ключевые моменты." }
  ],
  "media": [
    {
      "type": "audio",
      "mimeType": "audio/mp3",
      "name": "sample.mp3",
      "data": "<base64>"
    }
  ],
  "stream": false
}
```

#### Example Request (Image)
```json
{
  "model": "gemini-3-pro-image-preview",
  "prompt": "Миниатюрный город на плавающих островах, мягкий свет, акварель",
  "image": {
    "size": "1K",
    "aspectRatio": "9:16"
  }
}
```

#### Example Request (Nano Banana Follow-up Chat)
```json
{
  "model": "gemini-3-pro-image-preview",
  "messages": [
    {
      "role": "user",
      "content": "Draw a toy robot with a white background.",
      "parts": [
        { "text": "Draw a toy robot with a white background." }
      ]
    },
    {
      "role": "assistant",
      "content": "",
      "provider_state": {
        "role": "model",
        "parts": [
          { "inlineData": { "mimeType": "image/png", "data": "<base64-from-previous-response>" } }
        ]
      }
    },
    {
      "role": "user",
      "content": "Keep the same robot, but add blue eyes and a city background."
    }
  ],
  "image": {
    "size": "1K",
    "aspectRatio": "1:1"
  },
  "stream": false
}
```

#### Example Request (TTS, Gemini Single Speaker)
```json
{
  "model": "gemini-2.5-flash-preview-tts",
  "prompt": "Скажи бодро: Сегодня отличный день!",
  "tts": {
    "mode": "single",
    "voiceName": "Kore"
  },
  "stream": false
}
```

#### Example Request (TTS, Gemini Multi Speaker)
```json
{
  "model": "gemini-2.5-flash-preview-tts",
  "prompt": "Joe: Как дела? Jane: Отлично!",
  "tts": {
    "mode": "multi",
    "speakers": [
      { "speaker": "Joe", "voiceName": "Kore" },
      { "speaker": "Jane", "voiceName": "Puck" }
    ]
  },
  "stream": false
}
```

#### Example Request (Video)
```json
{
  "model": "veo-3.1-fast-generate-preview",
  "prompt": "Кинематографичный пролёт над неоновым городом, дождь, ночной свет",
  "video": {
    "aspectRatio": "16:9",
    "durationSeconds": 8,
    "resolution": "1080p",
    "count": 1
  }
}
```

#### Streaming Response Format (SSE)
Сервер отправляет события `data`.

**Success:**
```
data: {"content": "Часть текста ответа..."}

data: {"content": "Еще часть..."}

data: [DONE]
```

**Error:**
```
data: {"error": "Описание ошибки"}
```

#### Text Response (JSON)
```json
{
  "type": "text",
  "content": "Ответ модели",
  "finishReason": "STOP",
  "usage": {
    "inputTokens": 123,
    "outputTokens": 45,
    "totalTokens": 168
  },
  "blockedReason": null,
  "truncated": false,
  "metadata": {
    "requestedMaxTokens": null,
    "responseMimeType": "text/plain",
    "responseSchemaProvided": false,
    "strictJson": false,
    "provider": {
      "multimodal": true
    }
  }
}
```

#### Image Response (JSON)
```json
{
  "type": "image",
  "images": [
    { "data": "<base64>", "mimeType": "image/png" }
  ],
  "metadata": {
    "mode": "nano-banana",
    "model": "gemini-3-pro-image-preview",
    "count": 1
  }
}
```

#### Video Response (JSON)
```json
{
  "type": "video",
  "videos": [
    { "data": "<base64>", "mimeType": "video/mp4" }
  ],
  "metadata": {
    "mode": "veo",
    "model": "veo-3.1-fast-generate-preview",
    "count": 1,
    "durationSeconds": 8,
    "resolution": "1080p",
    "aspectRatio": "16:9"
  }
}
```

#### Audio Response (JSON)
```json
{
  "type": "audio",
  "audioUrl": null,
  "audio": {
    "data": "<base64>",
    "mimeType": "audio/wav"
  },
  "metadata": {
    "mode": "gemini-tts",
    "model": "gemini-2.5-flash-preview-tts",
    "voice": "Kore",
    "duration": 4.21
  }
}
```

## Frontend Notes
- В text-чате `Enter` отправляет сообщение.
- `Shift + Enter` добавляет перенос строки без отправки.
- Добавлена кнопка вложений (image/video/audio, множественный выбор до 10 файлов на запрос).
- Для `type=audio` доступен выбор режима TTS: Chatterbox или Gemini TTS (single/multi speaker, выбор голосов).
