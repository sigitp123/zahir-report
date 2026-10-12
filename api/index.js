// Entry point Vercel: seluruh aplikasi Express (server.js) dijalankan sebagai satu Vercel Function.
// server.js mendeteksi env VERCEL dan tidak membuka port sendiri.
module.exports = require('../server.js');
