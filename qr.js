const { makeid } = require('./id');
const QRCode = require('qrcode');
const express = require('express');
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const zlib = require('zlib');
const {
    default: makeWASocket,
    useMultiFileAuthState,
    Browsers,
    delay,
    makeCacheableSignalKeyStore,
    fetchLatestBaileysVersion,
    DisconnectReason,
} = require("@whiskeysockets/baileys");

const router = express.Router();

// ===== HELPER FUNCTIONS =====
function removeFile(filePath) {
    if (!fs.existsSync(filePath)) return false;
    fs.rmSync(filePath, { recursive: true, force: true });
    return true;
}

function generateSessionId() {
    const prefix = "SILA~";
    const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let sessionID = prefix;
    for (let i = prefix.length; i < 22; i++) {
        sessionID += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return sessionID;
}

// ===== QR CODE GENERATOR =====
router.get('/', async (req, res) => {
    const id = makeid();
    let num = req.query.number;
    let device = req.query.device || 'SILA-MD';

    // Hakikisha namba imetolewa
    if (!num) {
        return res.status(400).json({
            success: false,
            error: 'Number is required',
            message: 'Please provide a phone number with country code'
        });
    }

    // Safisha namba
    num = num.replace(/[^0-9]/g, '');

    if (num.length < 9) {
        return res.status(400).json({
            success: false,
            error: 'Invalid number. Use country code (e.g., 255...), at least 9 digits'
        });
    }

    let responseSent = false;
    let qrCode = null;

    async function SILA_QR() {
        const sessionPath = './temp/' + id;
        const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
        try {
            const { version } = await fetchLatestBaileysVersion();
            const logger = pino({ level: 'silent' });

            const client = makeWASocket({
                version,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, logger),
                },
                printQRInTerminal: false,
                logger,
                browser: Browsers.ubuntu('Chrome'),
                connectTimeoutMs: 60000,
                keepAliveIntervalMs: 10000,
            });

            client.ev.on('creds.update', saveCreds);

            // ===== QR CODE =====
            client.ev.on('connection.update', async (s) => {
                const { connection, lastDisconnect, qr } = s;

                // Tuma QR code ikiwa inapatikana
                if (qr && !responseSent) {
                    qrCode = qr;
                    console.log('📷 QR Code generated');

                    try {
                        // Tuma QR kama picha
                        const qrBuffer = await QRCode.toBuffer(qr, {
                            width: 350,
                            margin: 2,
                            color: {
                                dark: '#3b82f6',
                                light: '#0a0e1a'
                            }
                        });

                        responseSent = true;
                        res.setHeader('Content-Type', 'image/png');
                        res.setHeader('Content-Disposition', 'inline');
                        await res.end(qrBuffer);
                        console.log('✅ QR Code sent to frontend');
                    } catch (err) {
                        console.error('QR generation error:', err);
                        if (!responseSent) {
                            responseSent = true;
                            res.status(500).json({
                                success: false,
                                error: 'Failed to generate QR code',
                                details: err.message
                            });
                        }
                    }
                }

                // ===== CONNECTION OPEN =====
                if (connection === 'open') {
                    try {
                        console.log('✅ Connected successfully!');
                        console.log(`📱 User: ${client.user.id}`);
                        console.log(`👤 Name: ${client.user.name || 'Unknown'}`);

                        await delay(3000);
                        await saveCreds();

                        // Read session files
                        const authPath = './temp/' + id;
                        const files = fs.readdirSync(authPath);
                        const sessionData = {};

                        files.forEach(file => {
                            const filePath = path.join(authPath, file);
                            if (fs.statSync(filePath).isFile()) {
                                sessionData[file] = fs.readFileSync(filePath);
                            }
                        });

                        // Compress with zlib
                        const jsonData = JSON.stringify(sessionData);
                        const compressed = zlib.deflateSync(jsonData);
                        const base64Session = `SILA~${compressed.toString('base64')}`;

                        const sessionId = generateSessionId();

                        // Send session via WhatsApp
                        await client.sendMessage(client.user.id, {
                            text: `🔐 *SILA SESSION (QR)*\n\n` +
                                `📱 *Device:* ${device}\n` +
                                `🔑 *Session ID:* ${sessionId}\n\n` +
                                `\`\`\`${base64Session}\`\`\`\n\n` +
                                `⚠️ *Keep this code safe!*\nDo not share it with anyone.`
                        });

                        await delay(2000);

                        // Send success message with box
                        await client.sendMessage(client.user.id, {
                            text: `┏━❑ *SILA SESSION (QR)* ✅\n` +
                                `┏━❑ *SAFETY RULES* ━━━━━━━━━\n` +
                                `┃ 🔹 *Session:* Sent above.\n` +
                                `┃ 🔹 *Warning:* Do not share this code!\n` +
                                `┃ 🔹 Keep this code safe.\n` +
                                `┃ 🔹 Valid for 24 hours only.\n` +
                                `┗━━━━━━━━━━━━━━━\n\n` +
                                `> © 𝐏𝐨𝐰𝐞𝐫𝐞𝐝 𝐁𝐲 𝐒𝐈𝐋𝐀 𝐓𝐞𝐜𝐡`
                        });

                        console.log(`✅ Session sent to ${client.user.id}`);

                        // Clean up
                        await delay(2000);
                        await client.ws.close();
                        removeFile('./temp/' + id);
                        console.log(`🗑️ Cleaned up: ${id}`);

                    } catch (err) {
                        console.error('❌ Error sending session:', err);
                        removeFile('./temp/' + id);
                    }
                }

                // ===== DISCONNECT =====
                if (connection === 'close') {
                    const code = lastDisconnect?.error?.output?.statusCode;
                    console.log(`🔌 Connection closed with code: ${code}`);

                    if (code === DisconnectReason.loggedOut) {
                        console.log('❌ Device logged out');
                        if (!responseSent) {
                            responseSent = true;
                            res.status(400).json({
                                success: false,
                                error: 'Device logged out. Please logout from WhatsApp and try again.'
                            });
                        }
                    } else if (code !== DisconnectReason.loggedOut) {
                        console.log('🔄 Reconnecting...');
                        await delay(5000);
                        SILA_QR();
                    }
                }
            });

            // ===== TIMEOUT =====
            setTimeout(() => {
                if (!responseSent) {
                    responseSent = true;
                    res.status(408).json({
                        success: false,
                        error: 'Timeout! Please try again.'
                    });
                }
            }, 120000);

        } catch (err) {
            console.error('❌ SILA QR service error:', err);
            if (!responseSent) {
                responseSent = true;
                res.status(500).json({
                    success: false,
                    error: 'Service is Currently Unavailable',
                    details: err.message
                });
            }
            removeFile('./temp/' + id);
        }
    }

    return await SILA_QR();
});

module.exports = router;