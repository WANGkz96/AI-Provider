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
| `messages` | array | **Yes** | История чата. |
| `stream` | boolean | No | Включить стриминг ответов (SSE). Default: `false`. |
| `temperature` | number | No | Креативность (0.0 - 2.0). *Игнорируется для Thinking моделей*. |
| `topP` | number | No | Nucleus sampling (0.0 - 1.0). |
| `maxTokens` | number | No | Максимальное количество токенов в ответе. |
| `thinking` | object | No | **(New)** Настройки мышления (Reasoning). |

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

