// index.js
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import Redis from 'ioredis';
import crypto from 'crypto';
import { z } from 'zod';

import { OpenAIProvider, ClaudeProvider, MidjourneyProvider, HeyGenProvider } from './services/ai-providers.js';
import logger from './utils/logger.js';
import { getCache, setCache } from './utils/cache.js';
import { LandingPageSchema, LeadSchema } from './utils/schema.js';
import { LeadProcessor } from './services/lead-processor.js';
import { VariantManager } from './utils/variant-manager.js';

// ===== ENV CONFIG =====
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;
const MIDJOURNEY_API_KEY = process.env.MIDJOURNEY_API_KEY;
const HEYGEN_API_KEY = process.env.HEYGEN_API_KEY;
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS?.split(',') || '*';
const PORT = process.env.PORT || 10000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// ===== FATAL API KEY CHECK =====
const missingKeys = [];
if (!OPENAI_API_KEY) missingKeys.push('OPENAI_API_KEY');
if (!CLAUDE_API_KEY) missingKeys.push('CLAUDE_API_KEY');
if (!MIDJOURNEY_API_KEY) missingKeys.push('MIDJOURNEY_API_KEY');
if (!HEYGEN_API_KEY) missingKeys.push('HEYGEN_API_KEY');
if (missingKeys.length) {
  console.error('FATAL: Missing API keys:', missingKeys.join(', '));
  process.exit(1);
}

// ===== SERVICES =====
const redisClient = new Redis(REDIS_URL);
const openai = new OpenAIProvider(OPENAI_API_KEY);
const claude = new ClaudeProvider(CLAUDE_API_KEY);
const mj = new MidjourneyProvider(MIDJOURNEY_API_KEY);
const heygen = new HeyGenProvider(HEYGEN_API_KEY);
const leadProcessor = new LeadProcessor();
const variantManager = new VariantManager(redisClient);

// Cache wrapper
const cache = {
  get: (key) => getCache(redisClient, key),
  set: (key, value, ttl) => setCache(redisClient, key, value, ttl),
};

// ===== EXPRESS SETUP =====
const app = express();
app.use(helmet());
app.use(cors({ origin: ALLOWED_ORIGINS }));
app.use(express.json({ limit: '20kb' }));

// AI-Specific Rate Limiting
const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: NODE_ENV === 'production' ? 50 : 500,
  keyGenerator: (req) => req.ip + ':' + req.path,
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      error: "Too many AI requests. Please try again later.",
      requestId: req.requestId
    });
  },
});

// ===== REQUEST ID MIDDLEWARE =====
app.use((req, res, next) => {
  req.requestId = crypto.randomUUID();
  next();
});

// ===== AI ORCHESTRATION =====
async function generateLandingContent(keyword, variant = 'default', requestId = '') {
  let attempts = 0;
  const MAX_ATTEMPTS = 3;
  let rawContent = {};
  const testimonialsCacheKey = `testimonials:${keyword}`;

  while (attempts < MAX_ATTEMPTS) {
    try {
      logger.info(`[${requestId}] [${attempts + 1}/3] Generating content for keyword: ${keyword}, variant: ${variant}`);

      // Testimonials (cached)
      let claudeTestimonials = await cache.get(testimonialsCacheKey);
      if (!claudeTestimonials) {
        try {
          const resp = await claude.generate({
            model: "claude-3-opus-20240229",
            messages: [{
              role: "system",
              content: `Generate 3 highly believable testimonials for a luxury "${keyword}" service in Dubai as JSON array. Each must have name, quote, and rating fields.`
            }]
          });
          claudeTestimonials = JSON.parse(resp.content || '[]');
          await cache.set(testimonialsCacheKey, claudeTestimonials, 21600);
        } catch {
          logger.warn(`[${requestId}] Claude failed—using fallback testimonial.`);
          claudeTestimonials = [
            { name: "Client A", quote: "Outstanding craftsmanship and service.", rating: 5 },
            { name: "Client B", quote: "Exceeded all our expectations.", rating: 5 },
            { name: "Client C", quote: "Worth every dirham.", rating: 5 }
          ];
        }
      }

      // Parallel AI calls
      const [ textResp, imageResp, videoResp ] = await Promise.all([
        openai.generate({
          model: "gpt-4o",
          messages: [
            { 
              role: "system", 
              content: [
                "You are an expert marketing AI. Output **only** valid JSON,",
                "with **exactly** these keys (no more, no fewer):",
                "  • headline (string)",
                "  • subheadline (string)",
                "  • cta (string)",
                "  • whatsapp_message (string)",
                "  • hero_image_url (string)",
                "  • image_alt_text (string)",
                "  • meta_title (string)",
                "  • meta_description (string)",
                "",
                "Do not emit @context, @type, url, or any other fields.",
                "Return a single JSON object exactly matching those keys."
              ].join("\n")
            },
            { role: "user", content: `Generate landing page core content for: ${keyword}` }
          ],
          response_format: { type: "json_object" }
        }),
        mj.generate(`ultra-luxury ${keyword} in Dubai, modern, sophisticated, photorealistic, 8k`),
        heygen.generateVideo(keyword)
      ]);

      let gptParsed = {};
      try {
        gptParsed = JSON.parse(textResp.choices[0].message.content || '{}');
      } catch (jsonErr) {
        throw new Error("Malformed JSON from GPT-4o");
      }

      rawContent = {
        ...gptParsed,
        hero_image_url: imageResp.url,
        video_url: videoResp.url,
        testimonials: claudeTestimonials
      };

      const validated = LandingPageSchema.strict().parse(rawContent);
      logger.info(`[${requestId}] Generated & validated content.`);
      return validated;

    } catch (err) {
      attempts++;
      logger.error(`[${requestId}] Attempt ${attempts} failed: ${err.message}`);
      if (attempts < MAX_ATTEMPTS) await new Promise(r => setTimeout(r, 1000 * attempts));
    }
  }

  logger.error(`[${requestId}] All attempts failed—serving hardcoded fallback.`);
  return LandingPageSchema.strict().parse({
    headline: "Experience Unparalleled Luxury Renovations in Dubai",
    subheadline: "Bespoke design and meticulous execution for discerning clients.",
    cta: "Schedule a Consultation",
    whatsapp_message: "Hi, I'm interested in luxury renovation services in Dubai.",
    testimonials: [
      { name: "Satisfied Client", quote: "Our villa transformation was phenomenal!", rating: 5 },
      { name: "Royal Family Member", quote: "Discretion and quality at its finest.", rating: 5 },
      { name: "Business Executive", quote: "Completed on time and on budget.", rating: 5 }
    ],
    hero_image_url: "https://images.unsplash.com/photo-1582268494924-a7408f607106?auto=format&fit=crop&w=800&q=80",
    image_alt_text: "Luxurious villa interior design",
    meta_title: "Dubai Luxury Renovations | Elite Home Transformations",
    meta_description: "Discover bespoke luxury renovations for villas & apartments in Dubai.",
    video_url: "https://example.com/fallback-video.mp4"
  });
}

// ===== ROUTES =====

// Health check
app.get('/ping', (req, res) => {
  res.json({ success: true, status: "ok", timestamp: Date.now(), requestId: req.requestId });
});

// Personalized AI landing content
app.get('/api/personalize', aiLimiter, async (req, res) => {
  const keyword = (req.query.keyword || "luxury renovation dubai").toString();
  const variant = variantManager.getVariant(req);
  const cacheKey = `personalize:${keyword}:${variant}`;
  const requestId = req.requestId;

  try {
    const cached = await cache.get(cacheKey);
    if (cached) {
      logger.info(`[${requestId}] Cache HIT: ${cacheKey}`);
      return res.json({ success: true, ...cached, cache: "hit", variant, requestId });
    }
    logger.info(`[${requestId}] Cache MISS: ${cacheKey}`);
    const content = await generateLandingContent(keyword, variant, requestId);
    await cache.set(cacheKey, content, 21600);
    res.json({ success: true, ...content, cache: "miss", variant, requestId });
  } catch (err) {
    logger.error(`[${requestId}] /api/personalize error: ${err.message}`);
    res.status(500).json({
      success: false,
      error: "Failed to personalize. Try again.",
      requestId,
      fallback: {
        headline: "Luxury Dubai Renovations",
        subheadline: "Premium design and construction services",
        cta: "Contact Us Today",
        whatsapp_message: "Hello, I'd like information about your services",
        testimonials: [
          { name: "Client", quote: "Excellent service", rating: 5 }
        ],
        hero_image_url: "https://images.unsplash.com/photo-1582268494924-a7408f607106?auto=format&fit=crop&w=800&q=80",
        image_alt_text: "Luxury interior",
        meta_title: "Luxury Renovations Dubai",
        meta_description: "Premium renovation services in Dubai",
        video_url: "https://example.com/fallback-video.mp4"
      }
    });
  }
});

// Lead submission
app.post('/api/leads', async (req, res) => {
  const requestId = req.requestId;
  try {
    const lead = LeadSchema.strict().parse(req.body);
    logger.info(`[${requestId}] New lead: ${lead.phone}`);
    leadProcessor.processLead(lead)
      .then(() => logger.info(`[${requestId}] Lead processed`))
      .catch(e => logger.error(`[${requestId}] Lead error: ${e.message}`));
    res.json({ success: true, message: "Lead received", requestId });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: "Invalid lead", details: err.errors, requestId });
    }
    res.status(500).json({ success: false, error: "Lead failed", requestId });
  }
});

// ===== SERVER START =====
app.listen(PORT, () => {
  logger.info(`Server listening on port ${PORT} (${NODE_ENV})`);
  logger.info(`Redis URL: ${REDIS_URL}`);
});

// ===== SHUTDOWN HANDLERS =====
process.on('SIGTERM', async () => {
  logger.info('SIGTERM: shutting down…');
  await redisClient.quit();
  process.exit(0);
});
process.on('unhandledRejection', (r,p) => logger.error('UnhandledRejection', r));
process.on('uncaughtException', e => { logger.fatal('UncaughtException', e); process.exit(1); });
