const express = require('express');
const app = express();
__path = process.cwd();
const bodyParser = require("body-parser");
const port = process.env.PORT || 8000;

// ===== IMPORT ROUTES =====
let server = require('./qr');
let code = require('./pair');

// ===== CONFIGURATION =====
require('events').EventEmitter.defaultMaxListeners = 500;

// ===== MIDDLEWARE =====
app.use(express.static(__path));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// ===== ROUTES =====
app.use('/qr', server);
app.use('/code', code);

// Main page (home) - serve index.html
app.use('/', async (req, res, next) => {
    res.sendFile(__path + '/index.html');
});

// ===== START SERVER =====
app.listen(port, () => {
    console.log(`📡 SILA Session Generator Connected on http://localhost:${port}`);
    console.log(`📱 Pairing: http://localhost:${port}/code?number=2557xxxxxxxx`);
    console.log(`📷 QR: http://localhost:${port}/qr?number=2557xxxxxxxx`);
});

module.exports = app;