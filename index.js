const express = require('express');
const app = express();
const path = require('path');
const bodyParser = require("body-parser");
const port = process.env.PORT || 8000;

// ===== IMPORT ROUTES =====
let server = require('./qr');
let code = require('./pair');

// ===== CONFIGURATION =====
require('events').EventEmitter.defaultMaxListeners = 500;

// ===== MIDDLEWARE =====
app.use(express.static(path.join(__dirname)));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// ===== SERVE SILA FOLDER STATICALLY =====
app.use('/sila', express.static(path.join(__dirname, 'sila')));

// ===== ROUTES =====
app.use('/qr', server);
app.use('/code', code);

// Main page (home) - serve index.html from sila folder
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'sila', 'index.html'));
});

// ===== START SERVER =====
app.listen(port, () => {
    console.log(`📡 SILA Session Generator Connected on http://localhost:${port}`);
    console.log(`📱 Pairing: http://localhost:${port}/code?number=2557xxxxxxxx`);
    console.log(`📷 QR: http://localhost:${port}/qr?number=2557xxxxxxxx`);
    console.log(`🌐 Web UI: http://localhost:${port}/sila`);
});

module.exports = app;