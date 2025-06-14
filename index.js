const express = require('express');
const app = express();
const port = process.env.PORT || 10000;

app.get('/ping', (req, res) => {
  res.json({ message: 'pong 🧠 backend alive!' }); // ✅ JSON response
});

app.listen(port, () => {
  console.log(`🧠 Server running on port ${port}`);
});
