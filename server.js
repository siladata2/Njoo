const express = require('express');
const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');
const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Folders
const SESSIONS_DIR = './sessions';
const OUTPUT_DIR = './generated';
if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR);
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);

// Generate session Base64
app.post('/generate-session', async (req, res) => {
  const { phoneNumber } = req.body;
  
  if (!phoneNumber || phoneNumber.length < 9) {
    return res.status(400).json({ error: 'Namba sahihi tafadhali (2557xxxxxxxx)' });
  }

  // Clean phone number
  const cleanNumber = phoneNumber.replace(/\D/g, '');
  
  // Create unique session folder
  const sessionId = `session_${Date.now()}`;
  const sessionPath = path.join(SESSIONS_DIR, sessionId);
  
  try {
    // Initialize Baileys with multi-file auth state
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    
    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' })
    });

    let qrCode = null;
    let pairingCode = null;
    let isConnected = false;

    // Handle connection updates
    sock.ev.on('connection.update', async (update) => {
      const { connection, qr, lastDisconnect } = update;
      
      if (qr) {
        qrCode = qr;
        console.log('QR generated for session:', sessionId);
      }
      
      if (connection === 'open') {
        isConnected = true;
        console.log('✅ Bot connected successfully!');
        
        // Save credentials
        await saveCreds();
        
        // Read all session files
        const sessionFiles = fs.readdirSync(sessionPath);
        const sessionData = {};
        
        sessionFiles.forEach(file => {
          const filePath = path.join(sessionPath, file);
          if (fs.statSync(filePath).isFile()) {
            sessionData[file] = fs.readFileSync(filePath);
          }
        });
        
        // Compress using zlib
        const jsonData = JSON.stringify(sessionData);
        const compressed = zlib.deflateSync(jsonData);
        
        // Convert to Base64
        const base64Session = compressed.toString('base64');
        
        // Add SILA~ prefix
        const finalSession = `SILA~${base64Session}`;
        
        // Save to file
        const outputFile = path.join(OUTPUT_DIR, `${sessionId}.txt`);
        fs.writeFileSync(outputFile, finalSession);
        
        // Send response
        res.json({
          success: true,
          session: finalSession,
          sessionId: sessionId,
          qr: qrCode,
          message: '✅ Session generated successfully!',
          download: `/download/${sessionId}`
        });
        
        // Clean up session folder after 5 minutes
        setTimeout(() => {
          fs.rmSync(sessionPath, { recursive: true, force: true });
          console.log('🗑️ Session folder cleaned:', sessionId);
        }, 300000);
      }
      
      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        if (statusCode === DisconnectReason.loggedOut) {
          console.log('❌ Device logged out');
          return res.status(400).json({ error: 'Device logged out, scan again' });
        }
      }
    });

    // Request pairing code
    try {
      await sock.requestPairingCode(cleanNumber);
      console.log('📱 Pairing code requested for:', cleanNumber);
    } catch (error) {
      console.log('⏳ Waiting for QR scan...');
    }

    // Timeout after 2 minutes
    setTimeout(() => {
      if (!isConnected && !res.headersSent) {
        res.status(408).json({
          success: false,
          qr: qrCode,
          error: 'Timeout! Scan QR code or check pairing code'
        });
      }
    }, 120000);

  } catch (error) {
    console.error('❌ Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Download session
app.get('/download/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const filePath = path.join(OUTPUT_DIR, `${sessionId}.txt`);
  
  if (fs.existsSync(filePath)) {
    res.download(filePath, `${sessionId}.txt`);
  } else {
    res.status(404).json({ error: 'Session not found' });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    version: '1.0.0',
    sessions_generated: fs.readdirSync(OUTPUT_DIR).length 
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
