const express = require('express');
const QRCode = require('qrcode');
const fs = require('fs');
const pino = require('pino');
const zlib = require('zlib');
const path = require('path');
const { makeid } = require('./gen-id'); // Unda hii file

let router = express.Router();
let makeWASocket, useMultiFileAuthState, delay, Browsers, jidNormalizedUser;

// ============= HELPER FUNCTIONS =============
function removeFile(FilePath) {
    if (!fs.existsSync(FilePath)) return false;
    fs.rmSync(FilePath, { recursive: true, force: true });
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

// ============= MAIN ROUTE =============
router.get('/', async (req, res) => {
    const id = makeid();
    const num = req.query.number;
    const method = req.query.method || 'pair'; // 'pair' au 'qr'

    if (!num || num.length < 7) {
        return res.status(400).json({ 
            success: false,
            error: 'Tafadhali weka namba sahihi ya simu' 
        });
    }

    try {
        await BLAZE_MD_PAIR_CODE();
    } catch (err) {
        console.error('❌ Pairing route crashed:', err);
        if (!res.headersSent) {
            await res.status(502).json({ 
                success: false,
                error: 'Pairing service temporarily unavailable' 
            });
        }
    }

    async function BLAZE_MD_PAIR_CODE() {
        // Load baileys modules lazily
        if (!makeWASocket) {
            const baileys = await import('@whiskeysockets/baileys');
            makeWASocket = baileys.makeWASocket;
            useMultiFileAuthState = baileys.useMultiFileAuthState;
            delay = baileys.delay;
            Browsers = baileys.Browsers;
            jidNormalizedUser = baileys.jidNormalizedUser;
        }

        const { state, saveCreds } = await useMultiFileAuthState('./temp/' + id);

        try {
            const items = ["Safari", "Chrome", "Firefox"];
            const randomItem = items[Math.floor(Math.random() * items.length)];

            let sock = makeWASocket({
                auth: state,
                printQRInTerminal: false,
                logger: pino({ level: "silent" }),
                browser: Browsers.macOS(randomItem),
            });

            let qrCode = null;
            let isConnected = false;
            let responseSent = false;

            // ============ HANDLE PAIRING ============
            if (method === 'pair' && !sock.authState.creds.registered) {
                try {
                    // Request pairing code
                    const code = await sock.requestPairingCode(num);
                    console.log('📱 Pairing code sent to:', num);
                    
                    if (!responseSent) {
                        responseSent = true;
                        res.json({
                            success: true,
                            pairingCode: code,
                            message: 'Pairing code sent to your WhatsApp!'
                        });
                    }
                } catch (err) {
                    console.log('⚠️ Pairing failed, falling back to QR');
                    // Fallback to QR
                }
            }

            // ============ HANDLE QR ============
            sock.ev.on('connection.update', async (s) => {
                const { connection, qr, lastDisconnect } = s;

                // Capture QR
                if (qr) {
                    qrCode = qr;
                    console.log('📷 QR Code generated');
                    
                    if (method === 'qr' && !responseSent) {
                        responseSent = true;
                        res.json({
                            success: false,
                            qr: qrCode,
                            message: 'Scan QR code with WhatsApp to connect'
                        });
                    }
                }

                // ============ CONNECTION OPEN ============
                if (connection === "open" && sock?.user?.id) {
                    isConnected = true;
                    console.log('✅ Connected successfully!');
                    
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

                    // Send session to WhatsApp
                    const userJid = sock.user.id;
                    const sessionId = generateSessionId();

                    try {
                        // Send session via WhatsApp
                        await sock.sendMessage(userJid, {
                            text: `🔐 *Your Session Code:*\n\`\`\`${base64Session}\`\`\`\n\n⚠️ *Keep this code safe!*\nDo not share it with anyone.`
                        });

                        // Send success message
                        await sock.sendMessage(userJid, {
                            text: `✅ *Session Generated Successfully!*\n\n` +
                                  `📱 *Device:* ${sock.user.name || 'WhatsApp Bot'}\n` +
                                  `🔑 *Session ID:* ${sessionId}\n\n` +
                                  `> © Powered by SILA Session Generator`
                        });

                        console.log(`✅ Session sent to ${userJid}`);

                        // Send response to frontend
                        if (!responseSent) {
                            responseSent = true;
                            res.json({
                                success: true,
                                session: base64Session,
                                sessionId: sessionId,
                                whatsappMessage: '✅ Session sent to your WhatsApp!'
                            });
                        }

                    } catch (err) {
                        console.error('❌ Failed to send session:', err);
                        if (!responseSent) {
                            responseSent = true;
                            res.json({
                                success: true,
                                session: base64Session,
                                sessionId: sessionId,
                                whatsappMessage: '✅ Session generated! (Check console)'
                            });
                        }
                    }

                    // Clean up after 2 minutes
                    await delay(2000);
                    await sock.ws.close();
                    await removeFile('./temp/' + id);
                    console.log(`🗑️ Cleaned up: ${id}`);
                    return;
                }

                // ============ HANDLE DISCONNECT ============
                if (connection === "close" && lastDisconnect) {
                    const statusCode = lastDisconnect.error?.output?.statusCode;
                    if (statusCode === 401) {
                        console.log('❌ Device logged out');
                        if (!responseSent) {
                            responseSent = true;
                            res.status(400).json({
                                success: false,
                                error: 'Device logged out. Please logout from WhatsApp and try again.'
                            });
                        }
                    } else if (statusCode !== 401) {
                        // Reconnect
                        console.log('🔄 Reconnecting...');
                        await delay(3000);
                        BLAZE_MD_PAIR_CODE();
                    }
                }
            });

            // ============ TIMEOUT ============
            setTimeout(() => {
                if (!responseSent) {
                    responseSent = true;
                    res.status(408).json({
                        success: false,
                        qr: qrCode,
                        error: 'Timeout! Please try again.'
                    });
                }
            }, 120000);

        } catch (err) {
            console.log("⚠️ Connection failed:", err);
            await removeFile('./temp/' + id);
            if (!responseSent) {
                responseSent = true;
                res.status(500).json({
                    success: false,
                    error: err.message || 'Service unavailable'
                });
            }
        }
    }
});

// ============= GEN-ID HELPER =============
function makeid() {
    let result = '';
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const charactersLength = characters.length;
    let counter = 0;
    while (counter < 10) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
        counter += 1;
    }
    return result;
}

module.exports = router;