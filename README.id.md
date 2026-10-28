<p align="center">
  <img src="design/icon.png" width="128" alt="Ikon KlikPaper">
</p>

<h1 align="center">KlikPaper</h1>

<p align="center"><a href="README.md">English</a> · <b>Bahasa Indonesia</b></p>

<p align="center">
  Aplikasi PDF desktop yang gratis dan open source. Lihat, atur, kompres, konversi, beri anotasi, tanda tangani, dan kunci PDF di komputer Anda sendiri, tanyakan isinya dengan API key AI milik Anda, atau biarkan agen AI yang sudah Anda pakai mengerjakannya lewat MCP. Kecil, cepat, dan offline.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/github/license/ashafizullah/klikpaper?color=blue" alt="Lisensi MIT"></a>
  <img src="https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white" alt="Tauri 2">
  <img src="https://img.shields.io/badge/Svelte-5-FF3E00?logo=svelte&logoColor=white" alt="Svelte 5">
  <img src="https://img.shields.io/badge/Rust-stable-000000?logo=rust" alt="Rust">
  <a href="https://github.com/ashafizullah/klikpaper/actions/workflows/ci.yml"><img src="https://github.com/ashafizullah/klikpaper/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/ashafizullah/klikpaper/releases/latest"><img src="https://img.shields.io/github/v/release/ashafizullah/klikpaper?include_prereleases&label=rilis" alt="Rilis"></a>
  <a href="https://github.com/ashafizullah/klikpaper/releases"><img src="https://img.shields.io/github/downloads/ashafizullah/klikpaper/total?color=brightgreen&label=unduhan" alt="Unduhan"></a>
</p>

<p align="center">
  <a href="https://trakteer.id/adamshafizullah/tip"><img src="https://img.shields.io/badge/Traktir%20token%20AI-Trakteer-C02E2E?style=for-the-badge" alt="Traktir token AI di Trakteer"></a>
</p>

<p align="center">
  Bagian dari <a href="https://klikapps.pages.dev"><b>Klik Apps</b></a>, keluarga aplikasi desktop gratis dan open source: <a href="https://klikapps.pages.dev">klikapps.pages.dev</a>
</p>

<p align="center">
  <img src="design/screenshot.png" width="900" alt="KlikPaper dengan PDF yang disorot dan diberi catatan berfont tulisan tangan oleh agen AI lewat MCP, sidebar halaman, dan panel Tanya PDF ini">
</p>


## Fitur

- **Penampil**: gulir kontinu yang cepat, zoom dan pas lebar, pilih teks, cari di dokumen, tautan yang bisa diklik, formulir yang bisa diisi, tab untuk beberapa PDF
- **Kenali teks (OCR)**: ubah halaman hasil scan jadi bisa dicari. KlikPaper membaca bahasa Indonesia dan Inggris di komputer ini (Tesseract, sudah termasuk, tidak ada yang diunggah) lalu menaruh teksnya tak terlihat di atas scan, jadi bisa dicari, diblok, dan disalin, dibaca AI, dan disensor per kata. Tampilan halaman tidak berubah. OCR bisa salah membaca tulisan yang buram atau tulisan tangan, jadi jangan hanya mengandalkan pencarian untuk menemukan semuanya
- **Bookmark**: lihat daftar isi dokumen di sidebar, lompat ke bagian tertentu, serta tambah, ganti nama, susun bertingkat, urutkan, atau hapus bookmark; file yang digabung tetap membawa bookmark masing-masing
- **Proses banyak file** (Home, atau Berkas → Proses Banyak File): pilih beberapa file atau satu folder, lalu jalankan Kenali teks, sensor data pribadi, watermark, nomor halaman, kompres, kata sandi, dan hapus metadata untuk semuanya sekaligus, atau cukup buat laporan tanda tangan digitalnya. File baru disimpan ke folder pilihan Anda, file asli tidak pernah diubah, dan laporannya menjelaskan hasil tiap file
- **Cetak** (Cmd/Ctrl+P) dokumen persis seperti yang terlihat, termasuk perubahan yang belum disimpan. Halaman dikirim ke printer sebagai gambar 200 DPI
- **Atur halaman**: seret thumbnail untuk mengurutkan ulang, putar, hapus, gandakan, sisipkan halaman dari PDF lain, gabung beberapa file, pisah per rentang atau setiap N halaman, simpan halaman terpilih sebagai PDF baru, ubah ukuran halaman ke A4, Letter, Legal, A3, atau A5 (isi diskalakan agar pas, tidak ditarik)
- **Kompres**: tiga tingkat atau slider kualitas sendiri yang mengecilkan dan mengodekan ulang foto; teks, grafik vektor, dan font tidak diubah. Setiap tingkat menampilkan ukuran file hasilnya sebelum Anda menyimpan
- **Konversi**: gambar (JPG, PNG, WebP, GIF, BMP, TIFF) ke PDF, dan halaman ke PNG atau JPEG
- **Edit teks**: klik satu baris untuk mengubah kata-katanya; KlikPaper menutup baris lama dan menuliskannya lagi dengan font, ukuran, dan warna yang mirip. Kata lama tetap ada di file, di bawahnya, jadi **jangan pernah memakai Edit teks atau Tutup putih untuk menyembunyikan data pribadi**; pakai Sensor. Perubahan teks dan kotak tutup putih dicatat di riwayat edit file (lihat [Apa saja yang ditulis KlikPaper ke PDF Anda](#apa-saja-yang-ditulis-klikpaper-ke-pdf-anda))
- **Sensor (redaksi)**: sembunyikan data pribadi seperti NIK atau nomor rekening. Tarik kotak di atasnya, klik kanan teks yang diblok, atau sensor semua hasil pencarian sekaligus. Sebelum disimpan, tandanya masih transparan supaya bisa dicek, dan bisa dibatalkan dengan Urungkan. Saat disimpan, teks, piksel gambar, bentuk, tautan, dan isian formulir di bawah kotak hitam dihapus dari file, bukan cuma ditutupi, jadi tidak bisa disalin atau dikembalikan. Kalau isi sebuah halaman tidak bisa dihapus per bagian dengan aman, halaman itu disimpan sebagai gambar. KlikPaper menyarankan menyimpan hasilnya sebagai file baru supaya file asli tetap ada. **Sensor data pribadi** (menu ⋯) mencari NIK, NPWP, nomor HP, email, nomor rekening dan kartu, serta tanggal lahir sekaligus, untuk Anda periksa dulu sebelum ada yang ditandai. Lihat [Membagikan dokumen pribadi dengan aman](#membagikan-dokumen-pribadi-dengan-aman)
- **Anotasi**: sorot, garis bawah, dan coret teks (disimpan sebagai anotasi PDF asli yang bisa dilihat penampil lain), kotak teks dengan font apa pun yang terpasang di komputer Anda (disematkan saat disimpan), gambar tangan, persegi, elips, panah, penghapus putih, gambar
- **Komentar**: sematkan komentar di bagian mana pun pada halaman, balas, dan tandai selesai di panel Komentar. Komentar disimpan di dalam PDF sebagai catatan standar, jadi orang yang Anda kirimi file bisa membaca dan membalasnya di KlikPaper, Acrobat, atau Preview. Taruh filenya di folder bersama (Google Drive, Dropbox, OneDrive), dan KlikPaper langsung menampilkan balasan baru begitu ada yang menyimpan; tanpa akun atau server
- **Tanda tangan**: gambar, ketik, atau unggah tanda tangan, lalu tempatkan dan ubah ukurannya. Ini gambar tanda tangan Anda, bukan tanda tangan digital berbasis sertifikat
- **Cek tanda tangan digital**: PDF bertanda tangan digital (Acrobat, layanan tanda tangan elektronik pemerintah maupun perusahaan) menampilkan badge yang memberi tahu apakah tanda tangannya sah, apakah dokumen diubah setelah ditandatangani, dan siapa yang menandatangani dengan sertifikat apa. KlikPaper memeriksa dokumen dan kecocokan tanda tangan dengan sertifikatnya; KlikPaper tidak memeriksa apakah penerbit sertifikat tepercaya atau apakah sertifikat sudah dicabut, jadi untuk dokumen resmi gunakan juga layanan verifikasi milik penerbitnya. Menyimpan PDF bertanda tangan di KlikPaper akan menulis ulang file, jadi tanda tangannya tidak lagi sah di file yang disimpan; KlikPaper memperingatkan dan menyarankan file baru
- **Watermark dan nomor halaman**, langsung terlihat di setiap halaman
- **Kata sandi dan privasi**: buka PDF yang dikunci, kunci dengan AES-256, hapus kata sandi yang Anda ketahui, hapus metadata, ratakan isian formulir
- **Tanya PDF ini** (opsional): chat tentang dokumen yang terbuka, dengan jawaban yang merujuk halaman yang bisa diklik. Pakai key Anda sendiri untuk Anthropic (Claude) atau API apa pun yang kompatibel dengan OpenAI (OpenAI, OpenRouter, Gemini, Groq, Ollama...). AI-nya juga bisa memutar, memindah, atau menghapus halaman dan menambah teks saat Anda minta. Key disimpan di keychain sistem
- **Bekerja dengan agen AI Anda**: nyalakan server MCP lokal, lalu klien MCP apa pun (Claude Code, Codex, Gemini CLI, VS Code, Cursor, Windsurf, opencode, dan harness agen lain) bisa membaca dan mencari isi PDF yang terbuka, mengenali teks di halaman scan, menyorot, menambah teks, bentuk, gambar, dan tanda tangan, menyensor teks, area, atau data pribadi, mengubah bookmark, membaca dan membalas komentar, memeriksa tanda tangan digital, mengatur halaman, membuka dialog cetak, serta menggabung, memisah, mengompres, mengunci, mengonversi, atau memproses banyak file sekaligus. Terminal bawaan menjalankan agen Anda tepat di samping dokumen
- **Menu klik kanan** di halaman, teks yang diblok, anotasi, penanda komentar, thumbnail halaman, tab, dan file terbaru, berisi aksi yang sesuai dengan yang diklik
- **Urungkan dan ulangi** untuk perubahan halaman, anotasi, komentar, watermark, dan nomor halaman; tidak ada yang ditulis ke file sampai Anda menyimpan
- **Aksi klik kanan** (opsional): gabung, kompres, atau konversi PDF, atau ubah gambar jadi PDF, langsung dari menu File Explorer di Windows atau Quick Actions Finder di macOS
- **English dan Bahasa Indonesia** di seluruh aplikasi: antarmuka, bilah menu, pesan pembaruan, dan catatan "Yang baru"; **pembaruan otomatis** dari GitHub Releases (paket bertanda tangan), yang bisa Anda atur untuk terpasang sendiri, bertanya dulu, atau mati

## Membagikan dokumen pribadi dengan aman

Sensor menghapus isi di bawah kotak hitam pada halaman. Sebelum mengirim file yang sudah disensor:

1. **Tandai setiap tempat data itu muncul.** "Sensor data pribadi" di menu ⋯ mencari jenis data yang umum; pakai Cari lalu "Sensor semua hasil pencarian" untuk nama dan data lainnya. Untuk halaman hasil scan, jalankan Kenali teks dulu; OCR bisa salah baca, jadi periksa halamannya dan tarik kotak di atas apa pun yang terlewat oleh pencarian.
2. **Simpan sebagai file baru**, dan simpan file aslinya untuk diri sendiri.
3. **Periksa bagian yang tidak tersentuh Sensor**, karena tidak ada di halaman: nama file, judul bookmark, info dokumen seperti judul dan subjek (centang “Hapus info dokumen dan metadata” di ⋯ → Kata sandi & privasi), komentar, dan file lampiran di dalam PDF.
4. **Buka file hasilnya dan coba blok atau salin** area yang disensor. Seharusnya tidak ada yang keluar.

Edit teks dan Tutup putih hanya menutupi; isi aslinya tetap ada di file. Keduanya bukan untuk menyembunyikan apa pun.

## Apa saja yang ditulis KlikPaper ke PDF Anda

Selain perubahan yang Anda buat, file yang disimpan bisa membawa:

- **Komentar**, dengan nama yang Anda pakai untuk berkomentar (atur di Pengaturan)
- **Bookmark**
- **Riwayat edit**, kalau Anda mengubah teks (Edit teks), menutupi isi (Tutup putih), atau menyensor area: satu baris per kali simpan berisi tanggal, "KlikPaper" dan versinya, halaman mana yang berubah, dan berapa baris atau kotak. Tidak pernah berisi nama Anda, komputer Anda, atau isi teksnya
- **Keterangan bahwa ada bagian yang disensor**, supaya pembaca tahu kotak hitam itu bukan bagian dari dokumen asli

Riwayat edit dan keterangan ini ditampilkan KlikPaper (badge di toolbar dan Info dokumen) dan Acrobat di File → Properties → Custom. Tujuannya transparansi, supaya pembaca yang jujur tahu file itu pernah diubah; catatan ini tidak bisa mencegah orang yang memang berniat memalsukan PDF, karena editor PDF apa pun bisa menghapusnya. Mencentang **“Hapus info dokumen dan metadata”** di ⋯ → Kata sandi & privasi menyimpan file tanpa catatan ini, sekaligus tanpa judul, penulis, dan info dokumen lainnya.

## Privasi

KlikPaper bekerja offline, termasuk pengenalan teks (OCR). File Anda tidak pernah keluar dari komputer, dengan dua pengecualian yang Anda kendalikan:

- **Cek pembaruan** menanyakan versi yang lebih baru ke GitHub Releases dan, jika ada, mengambil catatan perubahannya dari GitHub (sekali sehari, atau hanya saat Anda minta jika cek otomatis dimatikan).
- **Chat AI**, jika Anda siapkan dan pakai, mengirim teks dokumen yang terbuka dan pertanyaan Anda ke penyedia AI yang Anda pilih, dengan API key Anda sendiri. Tidak ada yang dikirim ke KlikPaper atau pembuatnya.

Tidak ada akun, telemetri, maupun analitik.

## Unduh

Ambil versi terbaru dari **[Releases](https://github.com/ashafizullah/klikpaper/releases/latest)**:

| Platform | File |
|---|---|
| macOS 11+ (Apple Silicon & Intel) | `KlikPaper_x.y.z_universal.dmg` |
| Windows 10/11 (x64) | `KlikPaper_x.y.z_x64-setup.exe` atau `.msi` |
| Linux x86_64 | `.deb`, `.rpm`, atau `.AppImage` |

**macOS:** buka DMG lalu seret KlikPaper ke Applications. KlikPaper ditandatangani dan dinotarisasi Apple, jadi terbuka tanpa peringatan Gatekeeper. Atau pakai skrip instalasi, yang mengunduh DMG terbaru, menyalin KlikPaper ke Applications, lalu membukanya:

```sh
curl -fsSL https://raw.githubusercontent.com/ashafizullah/klikpaper/main/install.sh | bash
```

**Windows:** SmartScreen mungkin memperingatkan soal aplikasi yang belum ditandatangani. Klik **More info → Run anyway**.

## Memakai agen AI (MCP)

1. Buka **Pengaturan → Agen AI (MCP)** dan nyalakan server MCP lokal.
2. Pilih agen Anda dan salin langkah penyiapannya: perintah sekali jalan untuk Claude Code (`claude mcp add …`), Gemini CLI (`gemini mcp add …`), dan VS Code (`code --add-mcp …`), atau potongan konfigurasi untuk Codex (`~/.codex/config.toml`) dan Cursor (`~/.cursor/mcp.json`). KlikPaper adalah server MCP standar (Streamable HTTP dengan bearer token), jadi agen atau harness lain juga bisa: pilih **Lainnya** untuk mendapatkan URL server dan header `Authorization`.
3. Jalankan agen Anda (terminal bawaan KlikPaper, **Ctrl+`**, terbuka di folder dokumen) lalu minta, misalnya, *"gabungkan semua PDF di ~/Invoices jadi satu file urut tanggal"*, *"di dokumen yang terbuka, hapus halaman kosong dan tambahkan nomor halaman"*, *"sorot setiap penyebutan tenggat waktu"*, atau *"kenali teks semua scan di ~/Scans, sensor NIK dan nomor rekening, lalu simpan hasilnya ke ~/Scans/bersih"*.

Server hanya mendengarkan di `127.0.0.1` dan butuh token rahasia. KlikPaper tidak pernah menjalankan agen Anda, mengirimkan prompt kepadanya, atau menyentuh kredensialnya. Tool file tidak pernah menimpa file yang sudah ada kecuali diminta, dan hanya menulis file PDF, PNG, dan JPEG.

## Kebutuhan

- Tidak ada untuk tool PDF: semuanya bekerja offline
- Untuk **Tanya PDF ini**: API key untuk model chat (Claude, GPT, Gemini, OpenRouter…), atau server lokal yang kompatibel dengan OpenAI seperti Ollama
- Untuk **agen AI**: klien MCP atau harness agen apa pun yang mendukung Streamable HTTP (Claude Code, Codex, Gemini CLI, VS Code, Cursor, Windsurf, opencode…) di komputer yang sama

## Pengembangan

Butuh [Bun](https://bun.sh/) dan Rust stable. Di Linux, pasang juga [prasyarat Tauri](https://v2.tauri.app/start/prerequisites/#linux).

```sh
bun install
bun run tauri dev      # jalankan
bun run tauri build    # bundel
bun run check          # cek tipe
bun run test           # tes frontend
cargo test --manifest-path src-tauri/Cargo.toml
bun run notices        # cek lisensi + THIRD_PARTY_NOTICES.md
```

### Cara kerjanya

- `src/` adalah antarmuka Svelte 5. PDF.js merender halaman, lapisan teks, dan formulir; suntingan Anda ada di model dokumen (`src/lib/doc.svelte.ts`) berupa daftar halaman berurutan dari satu atau beberapa file plus anotasi, dengan riwayat urungkan.
- Saat menyimpan, daftar halaman dikirim ke Rust (`src-tauri/src/pdf/`), tempat lopdf menyusun file baru (gabung, urutkan ulang, putar, hapus), mengompres gambar, menghapus metadata, dan mengenkripsi. Anotasi, watermark, dan nomor halaman digambar dengan pdf-lib (`src/lib/draw.ts`) di antaranya.
- Webview hanya bisa membaca dan menulis PDF dan gambar (`src-tauri/src/files.rs`). API key tetap di keychain sistem dan tidak pernah sampai ke webview.

## Berkontribusi

Issue dan pull request dipersilakan. CI menjalankan cek tipe, tes, `cargo fmt`, `clippy`, `cargo test`, dan cek lisensi di macOS, Windows, dan Linux. Jalankan semuanya secara lokal sebelum membuka PR. Lihat [CONTRIBUTING.md](CONTRIBUTING.md) untuk penyiapan, pengecekan, dan panduan, termasuk aturan soal kode pihak ketiga.

### Merilis

Tambahkan bagian `## x.y.z` ke `CHANGELOG.md` dan bagian yang sama dalam bahasa Indonesia ke `CHANGELOG.id.md` (aplikasi menampilkan yang sesuai bahasa antarmuka setelah pembaruan), naikkan `version` di `tauri.conf.json`, `Cargo.toml`, dan `package.json`, lalu push sebuah tag. CI membangun DMG macOS yang ditandatangani dan dinotarisasi, installer Windows, dan paket Linux, menandatangani paket pembaruan, lalu melampirkan semuanya (termasuk `latest.json` untuk updater di aplikasi) ke draft release. Publikasikan draft itu untuk merilisnya.

Rilis butuh secret `TAURI_SIGNING_PRIVATE_KEY` (public key-nya ada di `tauri.conf.json`) plus `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_PASSWORD`, dan `APPLE_TEAM_ID` untuk penandatanganan dan notarisasi macOS.

```sh
git tag v0.1.1 && git push origin v0.1.1
```

Artwork installer Windows dan DMG di `src-tauri/installer/` dirender dari `design/installer/art.html` dengan `scripts/installer-art.sh`.

## Dukungan

KlikPaper gratis. Kalau aplikasi ini menghemat waktu Anda, **[traktir saya token AI di Trakteer](https://trakteer.id/adamshafizullah/tip)** ☕🤖.

## Lisensi

[MIT](LICENSE)

KlikPaper dibangun di atas [PDF.js](https://github.com/mozilla/pdf.js) (Apache-2.0), [pdf-lib](https://github.com/cantoo-scribe/pdf-lib) (MIT), dan [lopdf](https://github.com/J-F-Liu/lopdf) (MIT), serta menyertakan perangkat lunak pihak ketiga lain, termasuk font antarmuka Fraunces, IBM Plex Sans, dan IBM Plex Mono serta font Liberation Sans 2 untuk teks yang ditambahkan ke PDF (semuanya SIL Open Font License 1.1). Lisensinya ada di [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md), yang juga ditampilkan aplikasi di Pengaturan → Tentang → Lisensi open source. Jalankan `bun run notices` setelah mengubah dependensi.

Adobe dan Acrobat adalah merek dagang Adobe Inc. Claude dan Claude Code adalah merek dagang Anthropic; Codex adalah merek dagang OpenAI; nama produk lain adalah merek dagang pemiliknya masing-masing. KlikPaper adalah proyek independen dan tidak berafiliasi dengan atau didukung oleh Adobe, Anthropic, OpenAI, Google, maupun Mozilla.

<p>
  <a href="https://github.com/ashafizullah"><img src="https://github.com/ashafizullah.png?size=64" width="32" height="32" alt="" align="left" style="border-radius:50%"></a>
  &nbsp;Dibuat oleh <a href="https://github.com/ashafizullah"><b>Adam Suchi Hafizullah</b></a>
</p>
