const express = require('express');
const app = express();
const sessionRouter = require('./pair'); // Hii ni file ya server.js hapo juu

app.use(express.json());
app.use(express.static('public'));

// Route za session
app.use('/generate-session', sessionRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});