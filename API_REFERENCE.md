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

#### Parameters

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `model` | string | **Yes** | ID модели (из списка `/available-models`) |
| `messages` | array | No | История чата (для text моделей). |
| `prompt` | string | No | Прямой текст запроса (подходит для audio/image). |
| `stream` | boolean | No | Включить стриминг ответов (SSE). Default: `false`. |
| `temperature` | number | No | Креативность (0.0 - 2.0). *Игнорируется для Thinking моделей*. |
| `topP` | number | No | Nucleus sampling (0.0 - 1.0). |
| `maxTokens` | number | No | Максимальное количество токенов в ответе. |
| `thinking` | object | No | **(New)** Настройки мышления (Reasoning). |
| `image` | object | No | **(New)** Параметры генерации изображений. |
| `video` | object | No | **(New)** Параметры генерации видео. |

#### Message Object
```json
{
  "role": "user" | "assistant" | "system",
  "content": "Текст сообщения"
}
```

#### Thinking Object (New)
Используется только для моделей с поддержкой Reasoning (например, `gemini-3-flash-preview`).

```json
{
  "budget": number,      // Бюджет токенов на мышление (минимум 1024, если поддерживается)
  "includeThoughts": boolean // Возвращать ли процесс мышления в ответе
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

