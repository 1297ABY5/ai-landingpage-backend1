import express from 'express';
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('🎯 Unicorn Backend is Alive!');
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
