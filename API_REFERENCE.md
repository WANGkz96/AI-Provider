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
        "id": "gemma-3-27b-it",
        "provider": "google",
        "available": true,
        "type": "cloud"
      },
      {
        "id": "gemini-3-flash-preview",
        "provider": "google",
        "available": true,
        "type": "cloud"
      }
    ]
  }
  ```

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
| `stream` | boolean | No | Включить стриминг ответов (SSE). Default: `false`. |
| `temperature` | number | No | Креативность (0.0 - 2.0). *Игнорируется для Thinking моделей*. |
| `topP` | number | No | Nucleus sampling (0.0 - 1.0). |
| `maxTokens` | number | No | Максимальное количество токенов в ответе. |
| `thinking` | object | No | **(New)** Настройки мышления (Reasoning). |
| `tts` | object | No | **(New)** Настройки Text-to-Speech для моделей `type=audio` (Chatterbox / Gemini TTS). |
| `image` | object | No | **(New)** Параметры генерации изображений. |
| `video` | object | No | **(New)** Параметры генерации видео. |

#### Message Object
```json
{
  "role": "user" | "assistant" | "system",
  "content": "Текст сообщения"
}
```

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
    "tool_calls": [
      {
        "id": "call_1",
        "name": "ConductResearch",
        "arguments": {
          "research_topic": "..."
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
- Existing requests with `maxTokens`, plain `messages`, `prompt`, and legacy `responseMimeType` / `responseSchema` continue to work.
- `stream: false` is required when using `output`, `tools`, `tool_choice`, assistant `tool_calls`, or `tool` messages.

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

#### TTS Object (New)
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

