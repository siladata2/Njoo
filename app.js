const express = require('express');
const path = require('path');
const app = express();
const indexRouter = require('./index');

// ===== MIDDLEWARE =====
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ===== SERVE STATIC FILES =====
app.use('/sila', express.static(path.join(__dirname, 'sila')));

// ===== ROUTES =====
app.use('/', indexRouter);

// ===== ERROR HANDLER =====
app.use((err, req, res, next) => {
    console.error('❌ Server error:', err);
    res.status(500).json({
        success: false,
        error: 'Internal server error',
        details: err.message
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 SILA Session Generator running on http://localhost:${PORT}`);
    console.log(`📱 Pairing: http://localhost:${PORT}/pair?number=2557xxxxxxxx`);
    console.log(`📷 QR: http://localhost:${PORT}/qr?number=2557xxxxxxxx`);
    console.log(`🌐 Web UI: http://localhost:${PORT}/sila`);
});