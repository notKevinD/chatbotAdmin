# Penyimpanan Data RAG Sepenuhnya di n8n

Website hanya melakukan pengecekan awal nama file, mengirim file Excel, dan
menampilkan hasil proses. Semua operasi tulis ke `metadata_table` dan
`documents` dilakukan oleh workflow n8n.

## Data dari Website

Webhook menerima multipart form-data:

```text
file             = binary file Excel
mode             = reject | overwrite | duplicate
originalFileName = nama file yang dipilih admin
uploadFileName   = nama file efektif yang akan disimpan
```

## Alur Workflow

```text
Webhook
-> Set Variabel Upload
-> Postgres: Siapkan Metadata
-> Code: Baca Seluruh Sheet Excel
-> Default Data Loader
-> Text Splitter
-> Embeddings
-> Postgres PGVector Store
-> Postgres: Hitung Dokumen
-> IF jumlah dokumen > 0
   -> Postgres: Status Success
   -> Respond 200
-> Jika gagal
   -> Postgres: Status Failed
   -> Respond 500
```

## Persiapan Database

`metadata_name` harus unik agar dapat menggunakan `ON CONFLICT`:

```sql
alter table public.metadata_table
add constraint metadata_table_metadata_name_key unique (metadata_name);
```

## Node Set Variabel Upload

```text
mode              = {{ $json.body.mode || 'reject' }}
original_file_name = {{ $json.body.originalFileName || $binary.file.fileName }}
upload_file_name   = {{ $json.body.uploadFileName || $binary.file.fileName }}
```

Sesuaikan lokasi field dengan output Webhook. Pada beberapa versi n8n, field
multipart tersedia langsung pada `$json`, bukan `$json.body`.

## Node Postgres: Siapkan Metadata

Jalankan sebelum parsing dan PGVector:

```sql
with deleted_documents as (
  delete from public.documents
  where $2::text = 'overwrite'
    and (
      lower(metadata->>'metadata_name') = lower($1::text)
      or lower(metadata->>'fileName') = lower($1::text)
    )
  returning id
)
insert into public.metadata_table (
  metadata_name,
  status,
  error_message,
  updated_at
)
values ($1::text, 'processing', null, now())
on conflict (metadata_name)
do update set
  status = 'processing',
  error_message = null,
  updated_at = now()
returning id, metadata_name, status;
```

Query parameters:

```text
$1 = upload_file_name
$2 = mode
```

Jika mode `reject` dan nama file sudah ada, workflow sebaiknya dihentikan dengan
respons HTTP 409 sebelum node ini. Website juga melakukan pemeriksaan awal,
tetapi pemeriksaan n8n tetap diperlukan sebagai validasi utama.

## Metadata Dokumen

Gunakan nama `metadata_name`, bukan `source`, karena Data Loader dapat
menggunakan `source` untuk metadata internal.

Output Code:

```javascript
metadata: {
  metadata_name: uploadFileName,
  sheet: sheetName,
  row: index + 2
}
```

Pada Default Data Loader tambahkan metadata:

```text
metadata_name = {{ $('Code in JavaScript').item.json.metadata.metadata_name }}
sheet         = {{ $('Code in JavaScript').item.json.metadata.sheet }}
row           = {{ $('Code in JavaScript').item.json.metadata.row }}
```

## Node Postgres: Hitung Dokumen

```sql
select count(*)::int as document_count
from public.documents
where lower(metadata->>'metadata_name') = lower($1::text);
```

Parameter `$1` adalah `upload_file_name`.

## Status Success

```sql
update public.metadata_table
set
  status = 'success',
  error_message = null,
  updated_at = now()
where lower(metadata_name) = lower($1::text);
```

## Status Failed

```sql
update public.metadata_table
set
  status = 'failed',
  error_message = $2::text,
  updated_at = now()
where lower(metadata_name) = lower($1::text);
```

## Respons Berhasil

Respond to Webhook harus mengembalikan JSON:

```json
{
  "ok": true,
  "metadataName": "Data RAG SIMPLE.xlsx",
  "documentCount": 74
}
```

Gunakan HTTP status `200`. Untuk kegagalan, gunakan status `500` dan:

```json
{
  "ok": false,
  "error": "Pesan kegagalan proses RAG"
}
```
