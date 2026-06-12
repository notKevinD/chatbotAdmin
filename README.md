# AI Agent Chatbot Admin

Website admin berbasis Next.js untuk mengelola chatbot AI Agent n8n yang memakai RAG dengan PostgreSQL, pgvector, dan tabel chat memory.

Panel ini dibuat untuk membantu admin:

- Mengupload data RAG dari file Excel ke webhook n8n.
- Mengecek apakah file Excel sudah pernah diupload.
- Melihat daftar metadata RAG dan detail chunk dokumen.
- Menghapus metadata RAG atau chunk tertentu.
- Melihat dashboard penggunaan chatbot.
- Melihat riwayat session dan detail percakapan user-bot.
- Memantau pertanyaan bermasalah atau jawaban yang kemungkinan gagal.

## Teknologi

- Next.js 14 App Router untuk frontend dan API routes.
- React client component untuk dashboard interaktif.
- TypeScript untuk typing.
- PostgreSQL sebagai database utama.
- pgvector untuk menyimpan embedding RAG di tabel `documents`.
- n8n sebagai workflow AI Agent dan ingestion Excel.
- XLSX untuk membaca preview file Excel di browser.
- Cookie HTTP-only untuk login admin sederhana.

## Cara Menjalankan

Install dependency:

```bash
npm install
```

Buat file `.env.local`:

```env
DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/chatbot
AUTH_SECRET=random-string-panjang
N8N_RAG_UPLOAD_WEBHOOK=https://domain-n8n/webhook/rag-upload
```

Jalankan mode development:

```bash
npm run dev
```

Buka:

```text
http://localhost:3000
```

Build production:

```bash
npm run build
npm start
```

## Cara Pakai Untuk Admin

1. Buka halaman login.
2. Masukkan username dan password admin dari `.env.local`.
3. Masuk ke dashboard untuk melihat ringkasan penggunaan chatbot.
4. Pilih filter laporan:
   `Hari ini`, `Kemarin`, `Minggu ini`, `Minggu lalu`, `Bulan ini`, `Bulan lalu`, atau `Custom`.
5. Buka menu Data RAG untuk mengelola data knowledge base.
6. Pilih file Excel.
7. Sistem akan menampilkan preview Excel dalam pop-up, termasuk semua sheet jika file memiliki multisheet.
8. Jika file sudah pernah diupload, sistem memberi warning dan tombol berubah menjadi Timpa & Upload.
9. Jika admin memilih Timpa & Upload, sistem meminta konfirmasi sebelum menghapus data lama dan mengirim file baru ke webhook n8n.
10. Lihat daftar metadata RAG, jumlah chunk, status upload, dan detail dokumen.
11. Buka menu Riwayat Chat untuk melihat session pengguna dan detail percakapan.

## Cara Kerja Non Teknis

Admin mengupload file Excel berisi data kampus atau data FAQ. Sebelum dikirim ke n8n, aplikasi mengecek nama file ke database. Kalau nama file sudah pernah tercatat, admin diberi peringatan agar data tidak dobel.

Jika file aman, aplikasi mengirim Excel ke webhook n8n. Workflow n8n membaca isi Excel, mengubah tiap baris menjadi dokumen teks, membuat embedding, lalu menyimpan data ke PostgreSQL/pgvector.

Dashboard membaca data dari database untuk menampilkan jumlah pengguna, jumlah pertanyaan, grafik penggunaan, riwayat chat, dan contoh jawaban yang kemungkinan bermasalah.

## Cara Kerja Teknis

### Login Admin

Login memakai endpoint:

- `POST /api/auth/login`
- `POST /api/auth/logout`

Credential dibaca dari tabel:

- `admin_users`
- `admin_sessions`

Password admin disimpan dalam bentuk hash `scrypt`, bukan plaintext. Setelah login berhasil, aplikasi membuat session token random, menyimpan hash token ke `admin_sessions`, lalu mengirim token asli ke browser sebagai cookie HTTP-only.

Cookie session menggunakan:

- `HttpOnly`
- `SameSite=Lax`
- `Secure` saat `NODE_ENV=production`
- masa aktif 12 jam

Endpoint login juga memiliki rate limit sederhana berbasis email dan IP: 5 kali gagal dalam 15 menit.

### Upload RAG

Frontend membaca file Excel dengan `xlsx` hanya untuk preview. File tidak diproses menjadi RAG di frontend.

Alur upload:

1. Admin memilih file Excel.
2. Frontend memanggil:

```text
GET /api/admin/rag-upload?fileName=nama-file.xlsx
```

3. API mengecek `metadata_table.metadata_name`.
4. Jika file sudah ada, frontend menampilkan warning.
5. Jika belum ada, admin bisa klik Upload di modal preview.
6. Frontend mengirim file ke:

```text
POST /api/admin/rag-upload
```

7. API meneruskan file ke `N8N_RAG_UPLOAD_WEBHOOK`.
8. API mencatat status file ke `metadata_table` jika kolom status tersedia.

### Data RAG

Daftar metadata dibaca dari `metadata_table`.

Jumlah chunk dihitung dari tabel `documents` berdasarkan metadata di JSON:

- `metadata->>'source'`
- `metadata->>'metadata_name'`
- `metadata->>'metadataName'`
- `metadata->>'fileName'`

Detail dokumen menampilkan chunk dari tabel `documents`. Tombol Detail membuka pop-up yang berisi:

- Isi chunk.
- Metadata JSON.
- Raw row tanpa embedding penuh.

Embedding tidak ditampilkan penuh karena ukurannya panjang dan tidak nyaman dibaca.

### Riwayat Chat

Daftar session, isi percakapan, dan retrieval context dibaca dari tabel
`chat_history`, dengan pengelompokan berdasarkan `session_id`.

Tabel `message` tetap dapat digunakan oleh Postgres Chat Memory n8n, tetapi
tidak lagi menjadi sumber tampilan riwayat pada panel admin.

Yang dihitung sebagai jumlah chat di dashboard adalah jumlah pertanyaan user, bukan jumlah semua message. Ini dibuat agar metrik lebih masuk akal untuk penggunaan chatbot.

## Struktur Database

Database utama bernama `chatbot`.

Tabel yang dipakai:

```sql
admin_users (
  id uuid primary key,
  email varchar(255) unique not null,
  password_hash text not null,
  name varchar(255),
  role varchar(50) not null default 'admin',
  is_active boolean not null default true,
  created_at timestamp not null default now(),
  updated_at timestamp not null default now()
)
```

```sql
admin_sessions (
  id uuid primary key,
  user_id uuid not null references admin_users(id) on delete cascade,
  session_token_hash text not null,
  expires_at timestamp not null,
  created_at timestamp not null default now(),
  last_used_at timestamp not null default now(),
  user_agent text,
  ip_address text
)
```

```sql
documents (
  id uuid primary key,
  text text,
  metadata jsonb,
  embedding vector
)
```

```sql
metadata_table (
  id integer primary key,
  metadata_name varchar(255) not null,
  created_at timestamp default now()
)
```

```sql
message (
  id integer primary key,
  session_id varchar(255) not null,
  message jsonb not null
)
```

```sql
chat_sessions (
  id integer primary key,
  session_id varchar(255),
  created_at timestamp not null default now(),
  last_used_at timestamp not null default now()
)
```

```sql
chat_history (
  id bigint primary key,
  question text not null,
  answer text not null,
  context jsonb not null default '[]'::jsonb,
  time_start timestamp,
  time_end timestamp,
  session_id varchar(255) not null
)
```

Kolom tambahan yang direkomendasikan untuk status upload:

```sql
alter table public.metadata_table
add column if not exists status varchar(30) not null default 'success';

alter table public.metadata_table
add column if not exists error_message text;

alter table public.metadata_table
add column if not exists updated_at timestamp without time zone not null default now();

create index if not exists idx_metadata_table_status
on public.metadata_table (status);
```

Index yang direkomendasikan:

```sql
create index if not exists idx_admin_sessions_token_hash
on public.admin_sessions (session_token_hash);

create index if not exists idx_admin_sessions_expires_at
on public.admin_sessions (expires_at);

create index if not exists idx_message_session_id
on public.message (session_id);

create index if not exists idx_message_id_desc
on public.message (id desc);

create index if not exists idx_chat_sessions_last_used_at
on public.chat_sessions (last_used_at);

create index if not exists idx_chat_history_session_id
on public.chat_history (session_id);

create index if not exists idx_chat_history_time_start
on public.chat_history (time_start desc);

create index if not exists idx_metadata_table_metadata_name
on public.metadata_table (metadata_name);
```

## Setup Admin Pertama

Buat tabel auth:

```sql
create extension if not exists pgcrypto;

create table if not exists public.admin_users (
  id uuid primary key default gen_random_uuid(),
  email varchar(255) unique not null,
  password_hash text not null,
  name varchar(255),
  role varchar(50) not null default 'admin',
  is_active boolean not null default true,
  created_at timestamp without time zone not null default now(),
  updated_at timestamp without time zone not null default now()
);

create table if not exists public.admin_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.admin_users(id) on delete cascade,
  session_token_hash text not null,
  expires_at timestamp without time zone not null,
  created_at timestamp without time zone not null default now(),
  last_used_at timestamp without time zone not null default now(),
  user_agent text,
  ip_address text
);

create index if not exists idx_admin_sessions_token_hash
on public.admin_sessions (session_token_hash);

create index if not exists idx_admin_sessions_expires_at
on public.admin_sessions (expires_at);
```

Buat hash password:

```bash
node scripts/create-admin-password-hash.mjs "password-admin-yang-kuat"
```

Masukkan satu admin pertama:

```sql
insert into public.admin_users (email, password_hash, name, role)
values (
  'admin@example.com',
  'HASIL_HASH_DARI_SCRIPT',
  'Admin',
  'super_admin'
)
on conflict (email) do update
set password_hash = excluded.password_hash,
    name = excluded.name,
    role = excluded.role,
    is_active = true,
    updated_at = now();
```

## Catatan Workflow n8n

Webhook n8n menerima file dari field binary bernama `file`.

Metadata minimal yang sebaiknya disimpan di setiap dokumen:

```json
{
  "source": "nama-file.xlsx"
}
```

Jika Excel punya banyak sheet, metadata sebaiknya ditambah:

```json
{
  "source": "nama-file.xlsx",
  "sheet": "Nama Sheet"
}
```

Dengan begitu admin bisa tahu chunk berasal dari file dan sheet mana.

## Fitur Yang Sudah Ada

- Login admin.
- Dashboard penggunaan.
- Filter laporan berbasis tanggal.
- Grafik pertanyaan.
- Upload Excel dengan preview modal.
- Cek duplikat file ke `metadata_table`.
- Alert otomatis dan dismissible.
- Tabel metadata RAG dengan paginasi.
- Detail dokumen/chunk RAG.
- Pop-up detail chunk.
- Delete metadata dan delete chunk dengan modal konfirmasi.
- Riwayat chat per session.
- Detail percakapan user dan bot.
- Loading indicator saat mengambil data.

## Batasan Saat Ini

- Preview Excel menampilkan semua sheet, tetapi hanya 10 baris pertama per sheet agar modal tetap ringan.
- Proses pembuatan embedding tetap dilakukan oleh n8n, bukan oleh aplikasi admin.
- Deteksi jawaban bermasalah masih berbasis pola teks, sehingga perlu disesuaikan dengan gaya jawaban AI Agent.
- Upload file yang sudah pernah ada harus melewati konfirmasi overwrite agar data lama tidak tertimpa tanpa sengaja.

## Struktur Folder Penting

```text
app/admin-app.tsx                 UI utama admin
app/login/page.tsx                Halaman login
app/api/admin/overview/route.ts   API dashboard
app/api/admin/documents/route.ts  API data RAG
app/api/admin/chats/route.ts      API riwayat chat
app/api/admin/rag-upload/route.ts API upload Excel ke n8n
app/api/auth/login/route.ts       API login
app/api/auth/logout/route.ts      API logout
lib/db.ts                         Helper koneksi PostgreSQL
lib/auth.ts                       Helper autentikasi
```

## Evaluasi RAGAS

Tombol **Ekspor Data RAGAS** pada halaman Chat membaca data langsung dari tabel
`chat_history` sesuai periode dan kata pencarian yang aktif. File Excel berisi
`session_id`, `question`, `answer`, `context`, waktu respons, serta kolom
`reference` kosong yang dapat diisi manual sebagai jawaban acuan.

Script evaluasi tersedia di `scripts/run_ragas_evaluation.py`. File Excel input
harus memiliki kolom `question`, `answer`, dan `context`. Kolom `reference`
bersifat opsional.

Persiapan di Windows PowerShell:

```powershell
python -m venv .venv-ragas
.\.venv-ragas\Scripts\Activate.ps1
python -m pip install -r requirements-ragas.txt
$env:OPENAI_API_KEY="OPENAI_API_KEY_ANDA"
```

Uji tiga data terlebih dahulu:

```powershell
python scripts\run_ragas_evaluation.py "ragas-data.xlsx" --limit 3
```

Jalankan seluruh data dan tentukan nama hasil:

```powershell
python scripts\run_ragas_evaluation.py "ragas-data.xlsx" -o "hasil-ragas.xlsx"
```

Tanpa `reference`, script menghitung `faithfulness`, `answer_relevancy`, dan
`context_utilization`. Jika `reference` tersedia, script juga menghitung
`context_precision`, `context_recall`, dan `factual_correctness`.

Hasil juga memiliki `evaluation_time_seconds`, yaitu lama proses evaluasi RAGAS
untuk setiap baris. Nilai ini berbeda dari `response_time_ms`, karena
`response_time_ms` dihitung otomatis dari selisih `time_end` dan `time_start`
pada tabel `chat_history`.
