# Penyimpanan Chat History dari AI Agent n8n

AI Agent tetap menghasilkan jawaban teks biasa. Structured Output Parser,
Basic LLM Chain tambahan, kategori, dan `is_answered` tidak diperlukan.

## Alur Workflow

```text
Webhook
-> Set Start Time
-> AI Agent + PGVector Tool + Return Intermediate Steps
-> Code Ekstrak Context
-> Insert chat_history
-> Respond to Webhook
```

## Data yang Disimpan

Mapping node PostgreSQL Insert:

```text
question   = {{ $('Webhook').item.json.body.message }}
answer     = {{ $('AI Agent').item.json.output }}
context    = hasil ekstraksi retrieval dari intermediateSteps
time_start = {{ $('Set Start Time').item.json.time_start }}
time_end   = {{ $now.toISO() }}
session_id = {{ $('Webhook').item.json.body.sessionId }}
```

Pada node `Set Start Time`:

```text
time_start = {{ $now.toISO() }}
```

Pada `Respond to Webhook`:

```json
{
  "success": true,
  "response": "={{ $('AI Agent').item.json.output }}",
  "sessionId": "={{ $('Webhook').item.json.body.sessionId }}"
}
```

## Deteksi Jawaban Bermasalah

Panel admin membaca kolom `answer` dari `chat_history`. Jawaban dianggap
bermasalah jika mengandung kata `maaf`, tanpa memerlukan kolom tambahan.

Kolom `category` dan `is_answered` yang telanjur ada di PostgreSQL boleh
dibiarkan. Panel admin dan workflow tidak lagi menggunakannya.
