require('dotenv').config();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { rateLimit } = require('express-rate-limit');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const PUBLIC_DIR = path.join(__dirname, 'public');
const PRODUCT_UPLOAD_DIR = path.join(DATA_DIR, 'uploads', 'products');
const PROOF_UPLOAD_DIR = path.join(DATA_DIR, 'uploads', 'proofs');
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET || (!isProduction ? 'joy-galery-local-dev-secret-change-this-please' : null);
const ADMIN_PASSWORD_HASH = ADMIN_PASSWORD ? bcrypt.hashSync(ADMIN_PASSWORD, 10) : null;

if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
  console.error('\nKonfigurasi admin belum ada. Salin .env.example menjadi .env dan isi ADMIN_USERNAME serta ADMIN_PASSWORD.\n');
  process.exit(1);
}
if (!SESSION_SECRET) {
  console.error('\nSESSION_SECRET wajib diatur saat NODE_ENV=production.\n');
  process.exit(1);
}
if (isProduction && ADMIN_PASSWORD.length < 12) {
  console.warn('PERINGATAN: gunakan ADMIN_PASSWORD minimal 12 karakter di production.');
}
for (const dir of [DATA_DIR, PRODUCT_UPLOAD_DIR, PROOF_UPLOAD_DIR]) fs.mkdirSync(dir, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'joy-galery.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    category TEXT NOT NULL DEFAULT 'Produk Digital',
    description TEXT NOT NULL DEFAULT '',
    price INTEGER NOT NULL CHECK(price >= 0),
    image TEXT NOT NULL DEFAULT '/images/products/template-canva.svg',
    badge TEXT NOT NULL DEFAULT '',
    featured INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_code TEXT NOT NULL UNIQUE,
    product_id INTEGER,
    product_name TEXT NOT NULL,
    product_image TEXT NOT NULL,
    price INTEGER NOT NULL,
    customer_name TEXT NOT NULL,
    whatsapp TEXT NOT NULL,
    email TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    payment_proof TEXT,
    status TEXT NOT NULL DEFAULT 'waiting_payment',
    delivery_content TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
  CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);
`);

const initialProducts = [
  { name: 'Canva Template Bundle', slug: 'canva-template-bundle', category: 'Template Canva', description: 'Paket template Canva yang mudah diedit untuk kebutuhan konten dan desain sehari-hari. File digital dikirim setelah pembayaran dikonfirmasi.', price: 25000, image: '/images/products/template-canva.svg', badge: 'BEST SELLER', featured: 1 },
  { name: 'Aesthetic Moodboard Kit', slug: 'aesthetic-moodboard-kit', category: 'Moodboard', description: 'Kumpulan layout dan arahan visual bernuansa warm, maroon, dan beige untuk inspirasi personal maupun brand.', price: 18000, image: '/images/products/moodboard.svg', badge: 'AESTHETIC', featured: 1 },
  { name: 'Wording & Caption Pack', slug: 'wording-caption-pack', category: 'Wording', description: 'Inspirasi caption, bio, dan wording singkat untuk membantu kamu menemukan kalimat yang pas.', price: 12000, image: '/images/products/wording.svg', badge: '', featured: 1 },
  { name: 'Social Media Starter Kit', slug: 'social-media-starter-kit', category: 'Social Media', description: 'Paket awal untuk merapikan tampilan konten media sosial dengan gaya yang konsisten dan mudah disesuaikan.', price: 30000, image: '/images/products/social-kit.svg', badge: 'NEW', featured: 0 }
];
const productCount = db.prepare('SELECT COUNT(*) AS count FROM products').get().count;
if (productCount === 0) {
  const insertProduct = db.prepare(`INSERT INTO products (name, slug, category, description, price, image, badge, featured, active) VALUES (@name, @slug, @category, @description, @price, @image, @badge, @featured, 1)`);
  const seed = db.transaction((items) => items.forEach((item) => insertProduct.run(item)));
  seed(initialProducts);
}

const statuses = {
  waiting_payment: 'Menunggu pembayaran',
  pending_verification: 'Menunggu verifikasi',
  paid: 'Pembayaran terkonfirmasi',
  processing: 'Sedang diproses',
  completed: 'Selesai',
  cancelled: 'Dibatalkan'
};
app.locals.statuses = statuses;
app.locals.formatPrice = (value) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value || 0));
app.locals.formatDate = (value) => {
  if (!value) return '-';
  const normalized = String(value).includes('T') ? value : String(value).replace(' ', 'T') + 'Z';
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(date);
};
app.locals.statusClass = (status) => ({ waiting_payment: 'status-waiting', pending_verification: 'status-review', paid: 'status-paid', processing: 'status-process', completed: 'status-done', cancelled: 'status-cancelled' }[status] || 'status-waiting');
app.locals.deliveryIsUrl = (value) => /^https?:\/\/\S+$/i.test(String(value || '').trim());

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
if (isProduction) app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      fontSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
      styleSrc: ["'self'"],
      scriptSrc: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.static(PUBLIC_DIR, { maxAge: isProduction ? '1d' : 0 }));
app.use('/uploads/products', express.static(PRODUCT_UPLOAD_DIR, { maxAge: isProduction ? '1d' : 0, fallthrough: false }));
app.use(session({
  store: new SQLiteStore({ db: 'sessions.sqlite', dir: DATA_DIR, concurrentDB: true }),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  name: 'joygalery.sid',
  cookie: { httpOnly: true, sameSite: 'lax', secure: isProduction, maxAge: 1000 * 60 * 60 * 8 }
}));
app.use((req, res, next) => {
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  res.locals.csrfToken = req.session.csrfToken;
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  res.locals.isAdmin = Boolean(req.session.isAdmin);
  res.locals.currentPath = req.path;
  next();
});

const fileFilter = (req, file, cb) => {
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.mimetype)) {
    return cb(new Error('File harus berupa gambar JPG, PNG, WEBP, atau GIF.'));
  }
  cb(null, true);
};
const makeUpload = (destination, maxSize = 5 * 1024 * 1024) => multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, destination),
    filename: (_req, file, cb) => {
      const allowedExts = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
      const ext = allowedExts[file.mimetype] || '.img';
      cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
    }
  }),
  limits: { fileSize: maxSize, files: 1 },
  fileFilter
});
const productUpload = makeUpload(PRODUCT_UPLOAD_DIR, 6 * 1024 * 1024);
const proofUpload = makeUpload(PROOF_UPLOAD_DIR, 5 * 1024 * 1024);

function csrfGuard(req, res, next) {
  const submitted = String((req.body && req.body._csrf) || '');
  const expected = String(req.session.csrfToken || '');
  const valid = submitted.length === expected.length && submitted.length > 0 && crypto.timingSafeEqual(Buffer.from(submitted), Buffer.from(expected));
  if (valid) return next();
  if (req.file && req.file.path) fs.unlink(req.file.path, () => {});
  return res.status(403).render('error', { title: 'Sesi kedaluwarsa', message: 'Formulir sudah kedaluwarsa atau tidak valid. Silakan kembali dan coba lagi.' });
}
function ensureAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  req.session.flash = { type: 'error', message: 'Silakan login sebagai admin terlebih dahulu.' };
  return res.redirect('/admin/login');
}
function setFlash(req, type, message) { req.session.flash = { type, message }; }
function slugify(value) {
  return String(value || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70) || 'produk-digital';
}
function uniqueSlug(name, omitId = null) {
  const base = slugify(name);
  let slug = base;
  let suffix = 2;
  while (db.prepare('SELECT id FROM products WHERE slug = ? AND (? IS NULL OR id != ?)').get(slug, omitId, omitId)) {
    slug = `${base}-${suffix++}`;
  }
  return slug;
}
function getProductById(id) { const numericId = Number(id); if (!Number.isSafeInteger(numericId) || numericId < 1) return undefined; return db.prepare('SELECT * FROM products WHERE id = ?').get(numericId); }
function removeUploadedProductImage(imagePath) {
  if (!imagePath || !imagePath.startsWith('/uploads/products/')) return;
  const filename = path.basename(imagePath);
  const target = path.join(PRODUCT_UPLOAD_DIR, filename);
  if (target.startsWith(PRODUCT_UPLOAD_DIR + path.sep)) fs.unlink(target, () => {});
}
function cleanOldImage(oldImage, newImage) {
  if (oldImage && oldImage !== newImage) {
    const usage = db.prepare('SELECT COUNT(*) AS count FROM products WHERE image = ?').get(oldImage).count;
    if (usage === 0) removeUploadedProductImage(oldImage);
  }
}
function validPrice(value) {
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount >= 0 && amount <= 1000000000;
}
function orderCode() {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' }).replaceAll('-', '');
  return `JG-${today}-${crypto.randomBytes(10).toString('hex').toUpperCase()}`;
}

app.get('/', (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 80);
  const category = String(req.query.category || '').trim().slice(0, 80);
  let sql = 'SELECT * FROM products WHERE active = 1';
  const params = [];
  if (q) { sql += ' AND (name LIKE ? OR category LIKE ? OR description LIKE ?)'; params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (category) { sql += ' AND category = ?'; params.push(category); }
  sql += ' ORDER BY featured DESC, created_at DESC, id DESC';
  const products = db.prepare(sql).all(...params);
  const categories = db.prepare('SELECT DISTINCT category FROM products WHERE active = 1 ORDER BY category').all().map((row) => row.category);
  res.render('index', { title: 'Produk Digital yang Bikin Harimu Lebih Joyful', products, categories, q, category });
});

app.get('/produk/:slug', (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE slug = ? AND active = 1').get(req.params.slug);
  if (!product) return res.status(404).render('error', { title: 'Produk tidak ditemukan', message: 'Produk mungkin sudah tidak tersedia atau tautannya salah.' });
  const related = db.prepare('SELECT * FROM products WHERE active = 1 AND id != ? ORDER BY featured DESC, id DESC LIMIT 3').all(product.id);
  return res.render('product', { title: product.name, product, related });
});

app.get('/checkout', (req, res) => {
  const product = getProductById(req.query.product_id);
  if (!product || !product.active) return res.redirect('/');
  res.render('checkout', { title: 'Checkout QRIS', product });
});

app.post('/checkout', proofUpload.single('payment_proof'), csrfGuard, (req, res, next) => {
  try {
    const product = getProductById(req.body.product_id);
    if (!product || !product.active) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(400).render('error', { title: 'Produk tidak tersedia', message: 'Produk ini tidak tersedia untuk dibeli. Silakan pilih produk lain.' });
    }
    const customerName = String(req.body.customer_name || '').trim().slice(0, 100);
    const whatsapp = String(req.body.whatsapp || '').trim().slice(0, 30);
    const email = String(req.body.email || '').trim().slice(0, 160);
    const note = String(req.body.note || '').trim().slice(0, 500);
    if (!customerName || !whatsapp || !email || !/^\S+@\S+\.\S+$/.test(email)) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(400).render('error', { title: 'Data belum lengkap', message: 'Nama, nomor WhatsApp, dan email yang valid wajib diisi. Silakan ulangi checkout.' });
    }
    const code = orderCode();
    const proof = req.file ? path.basename(req.file.filename) : null;
    const status = proof ? 'pending_verification' : 'waiting_payment';
    db.prepare(`INSERT INTO orders (order_code, product_id, product_name, product_image, price, customer_name, whatsapp, email, note, payment_proof, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(code, product.id, product.name, product.image, product.price, customerName, whatsapp, email, note, proof, status);
    return res.redirect(`/pesanan/${encodeURIComponent(code)}`);
  } catch (error) { return next(error); }
});

app.get('/pesanan/:code', (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE order_code = ?').get(String(req.params.code).toUpperCase());
  if (!order) return res.status(404).render('error', { title: 'Pesanan tidak ditemukan', message: 'Kode pesanan tidak cocok. Periksa kembali tautan pesanan kamu.' });
  res.render('order-status', { title: `Pesanan ${order.order_code}`, order });
});

app.get('/admin/login', (req, res) => {
  if (req.session.isAdmin) return res.redirect('/admin');
  res.render('admin-login', { title: 'Login Admin' });
});
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false, message: 'Terlalu banyak percobaan login. Coba lagi dalam 15 menit.' });
app.post('/admin/login', loginLimiter, csrfGuard, async (req, res, next) => {
  try {
    const username = String(req.body.username || '');
    const password = String(req.body.password || '');
    const usernameBuffer = Buffer.from(username);
    const adminUsernameBuffer = Buffer.from(ADMIN_USERNAME);
    const validUser = usernameBuffer.length === adminUsernameBuffer.length && crypto.timingSafeEqual(usernameBuffer, adminUsernameBuffer);
    const validPassword = await bcrypt.compare(password, ADMIN_PASSWORD_HASH);
    if (!validUser || !validPassword) {
      setFlash(req, 'error', 'Username atau password salah.');
      return res.redirect('/admin/login');
    }
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.isAdmin = true;
      req.session.csrfToken = crypto.randomBytes(32).toString('hex');
      setFlash(req, 'success', 'Login berhasil. Selamat datang kembali!');
      return res.redirect('/admin');
    });
  } catch (error) { return next(error); }
});
app.post('/admin/logout', ensureAdmin, csrfGuard, (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('joygalery.sid');
    res.redirect('/');
  });
});

app.get('/admin', ensureAdmin, (req, res) => {
  const metrics = {
    products: db.prepare('SELECT COUNT(*) AS count FROM products').get().count,
    activeProducts: db.prepare('SELECT COUNT(*) AS count FROM products WHERE active = 1').get().count,
    totalOrders: db.prepare('SELECT COUNT(*) AS count FROM orders').get().count,
    toVerify: db.prepare("SELECT COUNT(*) AS count FROM orders WHERE status IN ('waiting_payment','pending_verification')").get().count,
    revenue: db.prepare("SELECT COALESCE(SUM(price), 0) AS total FROM orders WHERE status IN ('paid','processing','completed')").get().total
  };
  const recentOrders = db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT 8').all();
  res.render('admin-dashboard', { title: 'Ringkasan Admin', metrics, recentOrders });
});

app.get('/admin/products', ensureAdmin, (req, res) => {
  const products = db.prepare('SELECT * FROM products ORDER BY id DESC').all();
  res.render('admin-products', { title: 'Kelola Produk', products });
});
app.get('/admin/products/new', ensureAdmin, (req, res) => {
  res.render('admin-product-form', { title: 'Tambah Produk', product: null, formAction: '/admin/products/new' });
});
app.post('/admin/products/new', ensureAdmin, productUpload.single('image'), csrfGuard, (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim().slice(0, 120);
    const category = String(req.body.category || '').trim().slice(0, 80);
    const description = String(req.body.description || '').trim().slice(0, 2000);
    const price = Number(req.body.price);
    if (!name || !category || !description || !validPrice(price)) {
      if (req.file) fs.unlink(req.file.path, () => {});
      setFlash(req, 'error', 'Isi nama, kategori, deskripsi, dan harga yang valid.');
      return res.redirect('/admin/products/new');
    }
    const image = req.file ? `/uploads/products/${req.file.filename}` : '/images/products/template-canva.svg';
    db.prepare(`INSERT INTO products (name, slug, category, description, price, image, badge, featured, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(name, uniqueSlug(name), category, description, price, image, String(req.body.badge || '').trim().slice(0, 30), req.body.featured === 'on' ? 1 : 0, req.body.active === 'on' ? 1 : 0);
    setFlash(req, 'success', 'Produk baru berhasil ditambahkan.');
    return res.redirect('/admin/products');
  } catch (error) { return next(error); }
});
app.get('/admin/products/:id/edit', ensureAdmin, (req, res) => {
  const product = getProductById(req.params.id);
  if (!product) return res.status(404).render('error', { title: 'Produk tidak ditemukan', message: 'Produk yang kamu cari tidak ada.' });
  res.render('admin-product-form', { title: 'Edit Produk', product, formAction: `/admin/products/${product.id}/edit` });
});
app.post('/admin/products/:id/edit', ensureAdmin, productUpload.single('image'), csrfGuard, (req, res, next) => {
  try {
    const product = getProductById(req.params.id);
    if (!product) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(404).render('error', { title: 'Produk tidak ditemukan', message: 'Produk yang kamu cari tidak ada.' });
    }
    const name = String(req.body.name || '').trim().slice(0, 120);
    const category = String(req.body.category || '').trim().slice(0, 80);
    const description = String(req.body.description || '').trim().slice(0, 2000);
    const price = Number(req.body.price);
    if (!name || !category || !description || !validPrice(price)) {
      if (req.file) fs.unlink(req.file.path, () => {});
      setFlash(req, 'error', 'Isi nama, kategori, deskripsi, dan harga yang valid.');
      return res.redirect(`/admin/products/${product.id}/edit`);
    }
    const image = req.file ? `/uploads/products/${req.file.filename}` : product.image;
    const slug = name === product.name ? product.slug : uniqueSlug(name, product.id);
    db.prepare(`UPDATE products SET name = ?, slug = ?, category = ?, description = ?, price = ?, image = ?, badge = ?, featured = ?, active = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(name, slug, category, description, price, image, String(req.body.badge || '').trim().slice(0, 30), req.body.featured === 'on' ? 1 : 0, req.body.active === 'on' ? 1 : 0, product.id);
    cleanOldImage(product.image, image);
    setFlash(req, 'success', 'Perubahan produk berhasil disimpan.');
    return res.redirect('/admin/products');
  } catch (error) { return next(error); }
});
app.post('/admin/products/:id/delete', ensureAdmin, csrfGuard, (req, res) => {
  const product = getProductById(req.params.id);
  if (!product) {
    setFlash(req, 'error', 'Produk tidak ditemukan.');
    return res.redirect('/admin/products');
  }
  db.prepare('DELETE FROM products WHERE id = ?').run(product.id);
  cleanOldImage(product.image, null);
  setFlash(req, 'success', 'Produk berhasil dihapus dari katalog. Riwayat pesanan tetap disimpan.');
  return res.redirect('/admin/products');
});

app.get('/admin/orders', ensureAdmin, (req, res) => {
  const status = String(req.query.status || 'all');
  const search = String(req.query.q || '').trim().slice(0, 100);
  let sql = 'SELECT * FROM orders WHERE 1=1';
  const params = [];
  if (Object.hasOwn(statuses, status)) { sql += ' AND status = ?'; params.push(status); }
  if (search) { sql += ' AND (order_code LIKE ? OR customer_name LIKE ? OR email LIKE ? OR whatsapp LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`); }
  sql += ' ORDER BY id DESC LIMIT 300';
  const orders = db.prepare(sql).all(...params);
  res.render('admin-orders', { title: 'Pesanan Pelanggan', orders, selectedStatus: status, search });
});
app.get('/admin/orders/:id', ensureAdmin, (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(req.params.id));
  if (!order) return res.status(404).render('error', { title: 'Pesanan tidak ditemukan', message: 'Pesanan yang kamu cari tidak ada.' });
  res.render('admin-order-detail', { title: `Detail ${order.order_code}`, order });
});
app.get('/admin/payment-proof/:filename', ensureAdmin, (req, res) => {
  const filename = path.basename(req.params.filename);
  const target = path.join(PROOF_UPLOAD_DIR, filename);
  if (!target.startsWith(PROOF_UPLOAD_DIR + path.sep) || !fs.existsSync(target)) return res.status(404).send('Bukti pembayaran tidak ditemukan.');
  return res.sendFile(target, { headers: { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' } });
});
app.post('/admin/orders/:id/update', ensureAdmin, csrfGuard, (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(req.params.id));
  if (!order) {
    setFlash(req, 'error', 'Pesanan tidak ditemukan.');
    return res.redirect('/admin/orders');
  }
  const status = String(req.body.status || '');
  if (!Object.hasOwn(statuses, status)) {
    setFlash(req, 'error', 'Status pesanan tidak valid.');
    return res.redirect(`/admin/orders/${order.id}`);
  }
  const deliveryContent = String(req.body.delivery_content || '').trim().slice(0, 5000);
  db.prepare("UPDATE orders SET status = ?, delivery_content = ?, updated_at = datetime('now') WHERE id = ?").run(status, deliveryContent, order.id);
  setFlash(req, 'success', 'Status dan detail pengiriman berhasil diperbarui.');
  return res.redirect(`/admin/orders/${order.id}`);
});

app.use((req, res) => res.status(404).render('error', { title: 'Halaman tidak ditemukan', message: 'Halaman yang kamu cari tidak tersedia.' }));
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'Ukuran gambar terlalu besar. Silakan gunakan gambar yang lebih kecil.' : 'Upload gambar gagal. Silakan coba lagi.';
    return res.status(400).render('error', { title: 'Upload gagal', message });
  }
  if (err.message && err.message.startsWith('File harus')) return res.status(400).render('error', { title: 'Format file tidak didukung', message: err.message });
  return res.status(500).render('error', { title: 'Terjadi kendala', message: isProduction ? 'Ada kendala pada server. Silakan coba kembali beberapa saat lagi.' : `Terjadi kesalahan: ${err.message}` });
});

app.listen(PORT, () => {
  console.log(`Joy Galery berjalan di http://localhost:${PORT}`);
  console.log(`Data tersimpan di: ${DATA_DIR}`);
});
