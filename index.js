const express = require('express');
const app = express();

const PORT = process.env.PORT || 10000;

// --- HEALTH CHECK ENDPOINT ---
app.get('/ping', (req, res) => {
  res.json({ status: "ok", message: "pong", timestamp: Date.now() });
});

// (Other routes can go here)

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
