const express = require('express');
const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static('public'));

// TEMP folder for auth (deleted after use)
const TEMP_AUTH = './temp_auth';
if (!fs.existsSync(TEMP_AUTH)) fs.mkdirSync(TEMP_AUTH);

// Generate session
app.post('/generate-session', async (req, res) => {
    const { phoneNumber, method } = req.body;
    
    if (!phoneNumber || phoneNumber.length < 7) {
        return res.status(400).json({ error: 'Invalid phone number' });
    }

    const cleanNumber = phoneNumber.replace(/\D/g, '');
    const sessionId = `session_${Date.now()}`;
    const authPath = path.join(TEMP_AUTH, sessionId);
    
    try {
        // Initialize Baileys
        const { state, saveCreds } = await useMultiFileAuthState(authPath);
        const sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            logger: pino({ level: 'silent' })
        });

        let qrCode = null;
        let isConnected = false;
        let responseSent = false;

        // Handle connection
        sock.ev.on('connection.update', async (update) => {
            const { connection, qr, lastDisconnect } = update;
            
            if (qr) qrCode = qr;
            
            if (connection === 'open') {
                isConnected = true;
                await saveCreds();
                
                // Read session files
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

                // Send response
                if (!responseSent) {
                    responseSent = true;
                    res.json({
                        success: true,
                        session: base64Session,
                        sessionId: sessionId,
                        qr: qrCode,
                        whatsappMessage: `✅ Your bot session is ready! You can now use this session on your bot.`
                    });
                }

                // Clean up after 2 minutes
                setTimeout(() => {
                    fs.rmSync(authPath, { recursive: true, force: true });
                }, 120000);
            }

            if (connection === 'close') {
                const code = lastDisconnect?.error?.output?.statusCode;
                if (code === DisconnectReason.loggedOut) {
                    if (!responseSent) {
                        responseSent = true;
                        res.status(400).json({ 
                            error: 'Device logged out, please logout from WhatsApp and try again',
                            qr: qrCode
                        });
                    }
                }
            }
        });

        // Request pairing code if method is pair
        if (method === 'pair') {
            try {
                const code = await sock.requestPairingCode(cleanNumber);
                // Send code via WhatsApp
                await sock.sendMessage(cleanNumber + '@s.whatsapp.net', {
                    text: `🔐 *Your Pairing Code:*\n\`\`\`${code}\`\`\`\n\nEnter this code on your WhatsApp app to link your bot device.`
                });
                
                if (!responseSent) {
                    responseSent = true;
                    res.json({
                        success: true,
                        message: 'Pairing code sent to your WhatsApp!',
                        whatsappMessage: `✅ Pairing code sent to +${cleanNumber}`
                    });
                }
            } catch (error) {
                if (!responseSent) {
                    responseSent = true;
                    res.json({ 
                        success: true, 
                        qr: qrCode,
                        message: 'QR code generated, scan to connect'
                    });
                }
            }
        }

        // Timeout
        setTimeout(() => {
            if (!responseSent) {
                responseSent = true;
                res.status(408).json({
                    success: false,
                    qr: qrCode,
                    error: 'Timeout! Please try again'
                });
            }
        }, 120000);

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Download session
app.get('/download/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    const filePath = path.join(TEMP_AUTH, `${sessionId}.txt`);
    
    if (fs.existsSync(filePath)) {
        res.download(filePath, `session_${sessionId}.txt`);
    } else {
        res.status(404).json({ error: 'Session not found' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});