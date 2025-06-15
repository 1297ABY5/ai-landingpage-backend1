import express from 'express';

const app = express();
const PORT = process.env.PORT || 10000;

app.get('/ping', (req, res) => {
  res.json({ status: "ok", message: "pong", timestamp: Date.now() });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
