# OpenAI Runtime AI Manual Test

PR 4B adds the real OpenAI-backed runtime AI adapter for semantic extraction only. The runtime still does not execute bookings, mutate cases, send notifications, or move Telegram transport into the backend.

## Required environment

- `DATABASE_URL`
- `OPENAI_RUNTIME_ENABLED=true`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- Optional: `OPENAI_TIMEOUT_MS`

`OPENAI_RUNTIME_ENABLED` defaults to `false`. When it is not set to `true`, `/runtime/turn` uses `NoopRuntimeAIClient` so the backend can run without OpenAI credentials. When `OPENAI_RUNTIME_ENABLED=true`, both `OPENAI_API_KEY` and `OPENAI_MODEL` are required. `OPENAI_MODEL` must be provided by the environment; the runtime service does not hardcode a production model.

## Example curl

```bash
curl -sS -X POST http://localhost:3000/runtime/turn \
  -H 'content-type: application/json' \
  -d '{
    "clinic_code": "clinic_1",
    "channel": "telegram",
    "external_user_id": "8054104741",
    "chat_id": "8054104741",
    "text": "на 16 число есть место?",
    "meta": {
      "message_id": "1270",
      "update_id": "464427367",
      "username": "Mishae_l",
      "first_name": "Light",
      "last_name": null
    }
  }'
```

## Expected result

- `reply_text` is derived from the AI `reply_draft` when the structured output is valid; otherwise the safe fallback is returned.
- `debug.prompt_version` is `runtime-ai-extraction-v1`.
- `debug.ai_provider` is `openai`.
- `debug.ai_model` matches `OPENAI_MODEL`.
- `debug.ai_output` exists for valid structured AI output.
- `debug.ai_error` exists for provider failures or invalid AI output and must not include API keys or request headers.
- `booking_result` remains `null`.
- `side_effects` remains `[]`.
