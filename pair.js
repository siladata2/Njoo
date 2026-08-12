const { makeid } = require('./id');
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

// ===== HANDLE PAIRING FUNCTION =====
async function handlePair(num) {
    const id = makeid();
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

        // Request pairing code
        if (!client.authState.creds.registered) {
            try {
                await delay(1500);
                const code = await client.requestPairingCode(num);
                console.log(`📱 Pairing code sent to ${num}`);
                console.log(`🔑 Code: ${code}`);

                // Send session via WhatsApp after connection
                client.ev.on('connection.update', async (s) => {
                    const { connection, lastDisconnect } = s;

                    if (connection === 'open') {
                        try {
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

                            const sessionId = generateSessionId();

                            // Send session via WhatsApp
                            await client.sendMessage(client.user.id, {
                                text: `🔐 *SILA SESSION*\n\n` +
                                    `📱 *Device:* SILA-MD\n` +
                                    `🔑 *Session ID:* ${sessionId}\n\n` +
                                    `\`\`\`${base64Session}\`\`\`\n\n` +
                                    `⚠️ *Keep this code safe!*\nDo not share it with anyone.`
                            });

                            await delay(2000);

                            // Send success message
                            await client.sendMessage(client.user.id, {
                                text: `┏━❑ *SILA SESSION* ✅\n` +
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

                    if (connection === 'close') {
                        const code = lastDisconnect?.error?.output?.statusCode;
                        if (code === DisconnectReason.loggedOut) {
                            console.log('❌ Device logged out');
                        } else if (code !== DisconnectReason.loggedOut) {
                            console.log('🔄 Reconnecting...');
                            await delay(5000);
                            handlePair(num);
                        }
                    }
                });

                return {
                    success: true,
                    code: code,
                    message: 'Pairing code generated successfully!'
                };

            } catch (err) {
                console.error('❌ Pairing failed:', err);
                return {
                    success: false,
                    message: 'Failed to generate pairing code. Please try again.'
                };
            }
        }

    } catch (err) {
        console.error('❌ Pair service error:', err);
        removeFile('./temp/' + id);
        return {
            success: false,
            message: 'Service is Currently Unavailable'
        };
    }
}

// ===== ROUTER =====
router.get('/', async (req, res) => {
    const num = req.query.number;

    if (!num) {
        return res.status(400).json({
            success: false,
            message: 'Number is required'
        });
    }

    const result = await handlePair(num);
    res.json(result);
});

module.exports = router;
module.exports.handlePair = handlePair;