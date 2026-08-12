const express = require('express');
const router = express.Router();
const path = require('path');
const pairRouter = require('./pair');
const qrRouter = require('./qr');

// ===== ROOT ROUTER =====
router.get('/', (req, res) => {
    res.json({
        name: 'SILA Session Generator',
        version: '2.0.0',
        endpoints: {
            pair: '/pair?number=2557xxxxxxxx',
            qr: '/qr?number=2557xxxxxxxx',
            health: '/health',
            web: '/sila'
        },
        documentation: 'https://github.com/yourusername/sila-session-generator'
    });
});

// ===== SERVE SILA FRONTEND =====
router.get('/sila', (req, res) => {
    res.sendFile(path.join(__dirname, 'sila', 'index.html'));
});

// ===== HEALTH CHECK =====
router.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

// ===== PAIRING ROUTE =====
router.use('/pair', pairRouter);

// ===== QR ROUTE =====
router.use('/qr', qrRouter);

// ===== 404 HANDLER =====
router.use((req, res) => {
    res.status(404).json({
        success: false,
        error: 'Route not found',
        available: {
            pair: '/pair?number=2557xxxxxxxx',
            qr: '/qr?number=2557xxxxxxxx',
            health: '/health',
            web: '/sila'
        }
    });
});

module.exports = router;