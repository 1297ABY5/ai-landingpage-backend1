import express from 'express';
import { OpenAI_generate } from '../utils/openai.js';
import { Midjourney_generateImage } from '../utils/midjourney.js';
import { getCache, setCache } from '../utils/cache.js';
import { LandingPageSchema } from '../utils/schema.js';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const keyword = req.query.keyword || 'luxury renovation dubai';
    const cacheKey = `landing:${keyword.toLowerCase()}`;
    const cached = await getCache(cacheKey);

    if (cached) return res.json(cached);

    // Generate AI content
    const [textContent, imageUrl] = await Promise.all([
      OpenAI_generate({ prompt: `Create a luxury landing page for: ${keyword}` }),
      Midjourney_generateImage(keyword),
    ]);

    // Validate and structure
    const result = LandingPageSchema.parse({
      ...textContent,
      generated_image_url: imageUrl,
      whatsapp_message: `Hi, I need a ${keyword}. Can you help?`
    });

    await setCache(cacheKey, result, 21600); // 6 hours
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Something went wrong.' });
  }
});

export default router;
