# Catatan perubahan

Versi bahasa Indonesia dari [CHANGELOG.md](CHANGELOG.md). KlikPaper menampilkan bagian ini setelah pembaruan saat bahasa antarmukanya Bahasa Indonesia.

## Unreleased

- Pesan soal pembaruan (versi baru, sudah versi terbaru, galat) kini tampil sebagai alert di dalam aplikasi dalam bahasa antarmuka, bukan dialog sistem, lengkap dengan perubahan di versi barunya. Setelah pembaruan, alert "Yang baru" menampilkan daftar perubahannya sekali
- Pengaturan → Tentang punya tombol Cek pembaruan
- Bilah menu mengikuti bahasa antarmuka (English atau Bahasa Indonesia)
- File terakhir dibuka di Beranda bisa ditampilkan sebagai ubin atau daftar
- Kompres menjelaskan saat PDF tidak punya foto yang bisa dikecilkan, alih-alih menampilkan ukuran yang sama di semua tingkat tanpa keterangan
- Tanda dari `highlight_text` kini pas tepat dengan teksnya: posisi di dalam baris diukur dengan font PDF itu sendiri
- Kotak ukuran huruf menampilkan ukuran yang diatur agen, tidak lagi kosong

## 0.1.5

- Terminal bawaan (tombol di bilah judul atau Ctrl+`) untuk menjalankan agen Anda tepat di samping PDF; terbuka di folder dokumen yang aktif dan bisa mengetikkan perintah agennya untuk Anda
- Kotak teks bisa memakai font apa pun yang terpasang di komputer Anda (pilih di sebelah ukuran huruf); PDF yang disimpan menyematkan font itu, jadi tampilannya sama di mana pun. Font yang lisensinya melarang penyematan ditolak
- Pembaruan otomatis: versi baru diunduh di latar belakang dan dipasang saat Anda menutup aplikasi, atau langsung lewat Mulai ulang untuk memperbarui. Di Pengaturan → Umum Anda bisa memilih ditanya dulu atau hanya mengecek saat diminta
- Kompres menampilkan ukuran file hasil untuk setiap tingkat sebelum Anda menyimpan, dan punya slider kualitas Atur sendiri (juga `quality` di tool MCP `compress_pdf`)
- Aksi klik kanan: opsi di Pengaturan → Umum menambahkan Gabung, Kompres, dan Ubah jadi gambar dengan KlikPaper untuk PDF, serta Ubah jadi PDF dengan KlikPaper untuk gambar, ke menu klik kanan File Explorer di Windows (di bawah Show more options pada Windows 11) dan ke Quick Actions Finder di macOS
- Kompres dan Ekspor sebagai gambar ada di toolbar
- Tombol + di sebelah tab (atau Ctrl/⌘+T, Berkas → Tab Baru) membuka tab Beranda, bukan langsung pemilih file; file yang dibuka dari sana menggantikan tab itu
- Tanda sorot tidak lagi menutupi teks di bawahnya di layar (file yang disimpan sudah benar sejak awal)
- Tool MCP dan chat AI baru: menandai, menggarisbawahi, atau mencoret frasa (`highlight_text`), menggambar bentuk, panah, penghapus putih, dan coretan (`add_shape`), menempatkan gambar atau tanda tangan tersimpan (`add_image`), menampilkan dan menghapus anotasi, menggandakan halaman, urungkan dan ulangi, menutup dokumen, serta menampilkan font yang terpasang (`list_fonts`); `add_text` menerima font dan mengembalikan id kotak teks barunya

## 0.1.4

- Server MCP kini punya langkah penyiapan untuk Codex, Gemini CLI, VS Code, dan Cursor selain Claude Code, plus URL dan header mentah untuk klien lain; bilah judul menampilkan agen yang terhubung

## 0.1.3

- Teks yang ditambahkan ke PDF kini memakai Liberation Sans 2 (SIL Open Font License), bukan font 1.x berlisensi GPL

## 0.1.2

- Pemberitahuan pihak ketiga kini memuat setiap teks lisensi dan pemberitahuan untuk paket dengan lebih dari satu lisensi, serta tautan sumber untuk crate MPL-2.0
- Baris hak cipta aplikasi kini mencantumkan pembuatnya

## 0.1.1

- Pemberitahuan pihak ketiga kini memuat teks lisensi lengkap untuk setiap crate
- Gambar ke PDF kini benar-benar menerima GIF, BMP, dan TIFF seperti yang dijanjikan (sebelumnya hanya JPEG, PNG, dan WebP yang dibaca)
- Kredit untuk PDF.js atas gaya lapisan teks dan anotasi yang diadaptasi dari penampilnya, dan lisensi font Liberation Sans kini disebut dengan benar di pemberitahuan
- README: klaim soal urungkan kini menyebut apa saja yang bisa diurungkan

## 0.1.0

- Rilis pertama: melihat, mengatur (mengurutkan ulang, memutar, menghapus, menggandakan, menyisipkan, menggabung, memisah, mengambil halaman), mengompres, mengonversi (gambar ↔ PDF), menganotasi (sorot, garis bawah, coret, teks, gambar tangan, bentuk, panah, penghapus putih, gambar), tanda tangan, watermark, nomor halaman, perlindungan kata sandi (AES-256), penghapusan metadata, dan pengisian formulir
- Tanya PDF ini: chat tentang dokumen yang terbuka dengan API key Anthropic atau yang kompatibel dengan OpenAI milik Anda sendiri, dengan rujukan halaman yang bisa diklik
- Server MCP lokal agar Claude Code Anda sendiri bisa bekerja dengan dokumen yang terbuka dan file PDF
- English dan Bahasa Indonesia
