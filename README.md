# Joy Galery — Digital Storefront

Web app full-stack berbahasa Indonesia untuk menjual produk digital seperti template Canva, moodboard, wording, dan aset kreatif. Tema visual dominan maroon dengan beige/cream sebagai warna pendamping.

## Fitur

- Katalog produk publik, pencarian, filter kategori, halaman detail produk.
- Checkout dengan QRIS dan form nama, WhatsApp, email, catatan, serta upload bukti bayar.
- QRIS yang kamu kirim disimpan langsung di `public/images/qris.png` dan tampil di checkout.
- Status pesanan: menunggu pembayaran, menunggu verifikasi, pembayaran terkonfirmasi, diproses, selesai, dibatalkan.
- Halaman status pesanan untuk pelanggan; detail/link produk digital dapat ditambahkan admin setelah order selesai.
- Login admin dengan username/password environment, rate limit login, session tersimpan di SQLite, serta perlindungan CSRF.
- Dashboard admin, pencarian/filter pesanan, pemeriksaan bukti pembayaran, edit/tambah/hapus produk, harga, kategori, deskripsi, foto, label, featured, dan status publikasi.
- Data katalog, pesanan, sesi, dan file upload disimpan di direktori `DATA_DIR` agar dapat menggunakan persistent disk.
- Desain responsif untuk ponsel dan desktop.

## Penting sebelum menerima pembayaran sungguhan

Kode QRIS yang dikirim menampilkan merchant **Digital & Kreatif** dan terlihat seperti QRIS statis (nominal tidak tertanam). Situs ini menampilkan kode tersebut persis seperti yang diberikan. **Jangan publikasikan atau minta pelanggan membayar sebelum memastikan merchant tersebut memang rekening/akun penerima yang kamu gunakan untuk Joy Galery.** Jika bukan milikmu, ganti `public/images/qris.png` dengan QRIS resmi atas nama penerima yang benar.

Pembayaran tidak terhubung ke API bank/payment gateway. Pembeli dapat unggah screenshot, tetapi admin harus memeriksa transaksi masuk secara mandiri sebelum mengubah status ke "Pembayaran terkonfirmasi". Jangan menganggap screenshot sebagai bukti final tanpa memeriksa riwayat transaksi penerima. QRIS ini tidak mengisi nominal pesanan secara otomatis, jadi pelanggan harus memasukkan nominal sesuai total dan memeriksa nama merchant di aplikasi pembayaran.

Produk bawaan pada katalog adalah **contoh/demo**. Edit, ganti, atau nonaktifkan konten tersebut dari dashboard sebelum toko dipublikasikan. Pastikan produk digital, lisensi, kebijakan refund, serta cara pengiriman yang kamu tawarkan benar.

## Jalankan secara lokal

Persyaratan: Node.js 20 atau lebih baru dan npm.

1. Salin `.env.example` menjadi `.env`.
2. Isi username dan password admin yang kuat; gunakan minimal 12 karakter untuk password. Isi `SESSION_SECRET` dengan string acak panjang (minimal 32 karakter).
3. Jalankan:

   ```bash
   npm install
   npm start
   ```

4. Buka `http://localhost:3000`.
5. Panel admin: `http://localhost:3000/admin/login`.

Contoh pembuatan secret acak:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Simpan secret tersebut ke `SESSION_SECRET` di `.env`. Jangan mengunggah `.env` ke GitHub atau repo publik.

## Deploy ke Render

File `render.yaml` sudah disediakan sebagai blueprint. Blueprint menggunakan web service Starter dan persistent disk 1 GB agar pesanan, database SQLite, sesi, bukti pembayaran, dan foto yang diunggah tidak hilang saat deploy ulang.

1. Masukkan folder project ini ke repo Git milikmu.
2. Di Render, pilih **New → Blueprint** lalu hubungkan repo.
3. Isi nilai rahasia `ADMIN_USERNAME` dan `ADMIN_PASSWORD` yang diminta Render. Gunakan password yang unik dan panjang.
4. Deploy, lalu buka URL yang diberikan Render.
5. Masuk ke `/admin/login`, edit produk demo, dan cek pengaturan QRIS sebelum mengumumkan toko.

Persistent disk pada Render memerlukan paket/service yang mendukung disk dan mungkin menimbulkan biaya. Jika memakai platform lain, pasang persistent volume dan set `DATA_DIR` ke path volume tersebut. Tanpa persistent storage, file database dan upload bisa hilang ketika instance diganti.

## Deploy dengan Docker

```bash
docker build -t joy-galery .
docker run --rm -p 3000:3000 \
  -e NODE_ENV=production \
  -e DATA_DIR=/data \
  -e ADMIN_USERNAME=admin \
  -e ADMIN_PASSWORD='ganti-password-yang-kuat' \
  -e SESSION_SECRET='ganti-dengan-secret-acak-minimal-32-karakter' \
  -v joy-galery-data:/data \
  joy-galery
```

## Struktur penyimpanan

- `DATA_DIR/joy-galery.sqlite` — produk dan pesanan.
- `DATA_DIR/sessions.sqlite` — sesi login admin.
- `DATA_DIR/uploads/products/` — foto produk yang diunggah melalui admin.
- `DATA_DIR/uploads/proofs/` — bukti pembayaran, hanya dapat diakses setelah admin login.
- `public/images/qris.png` — gambar QRIS awal yang disertakan pada project.

## Catatan pengelolaan

- Jangan pernah bagikan login admin kepada pelanggan.
- Admin perlu mengonfirmasi pembayaran secara manual berdasarkan transaksi yang benar-benar masuk.
- Masukkan URL unduhan atau instruksi pengiriman di detail pesanan, lalu ubah status ke "Selesai". Pelanggan bisa melihatnya pada URL unik halaman status pesanan.
- Backup direktori `DATA_DIR` secara berkala karena berisi database dan upload.
- Gunakan HTTPS pada production; konfigurasi cookie aman otomatis aktif ketika `NODE_ENV=production`.
