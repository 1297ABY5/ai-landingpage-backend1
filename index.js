// index.js
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import Redis from 'ioredis'; // This is the package causing trouble on Render
import crypto from 'crypto';
import { z } from 'zod';

// These imports are correct if services/ and utils/ are sibling folders to index.js
import { OpenAIProvider, ClaudeProvider, MidjourneyProvider, HeyGenProvider } from './services/ai-providers.js';
import logger from './utils/logger.js';
import { getCache, setCache } from './utils/cache.js';
import { LandingPageSchema, LeadSchema } from './utils/schemas.js';
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
  let testimonialsCacheKey = `testimonials:${keyword}`;

  while (attempts < MAX_ATTEMPTS) {
    try {
      logger.info(`[${requestId}] [${attempts + 1}/3] Generating content for keyword: ${keyword}, variant: ${variant}`);
      // Try get testimonials from cache first (Claude is $$$)
      let claudeParsedTestimonials = await cache.get(testimonialsCacheKey);
      if (!claudeParsedTestimonials) {
        try {
          const claudeResponse = await claude.generate({
            model: "claude-3-opus-20240229",
            messages: [{
              role: "system",
              content: `Generate 3 highly believable testimonials for a luxury "${keyword}" service in Dubai. JSON: [{"name": "...", "quote": "...", "rating": 5}]`
            }]
          });
          claudeParsedTestimonials = JSON.parse(claudeResponse.content || '[]');
          await cache.set(testimonialsCacheKey, claudeParsedTestimonials, 21600);
        } catch (claudeErr) {
          logger.warn(`[${requestId}] Claude testimonial failed: ${claudeErr.message}`);
          claudeParsedTestimonials = [
            { name: "Client A", quote: "Outstanding craftsmanship and service.", rating: 5, project_type: "General" }
          ];
        }
      }

      // Run content/image/video in parallel
      const [textResponse, imageResponse, videoResponse] = await Promise.all([
        openai.chat.completions.create({
          model: "gpt-4o",
          messages: [{
            role: "system",
            content: `You are a Dubai luxury marketing AI. Generate JSON for a luxury landing page for "${keyword}". Must conform to LandingPageSchema.`
          }, {
            role: "user",
            content: `Generate landing page core content for: ${keyword}`
          }],
          response_format: { type: "json_object" }
        }),
        mj.generate(`ultra-luxury ${keyword} in Dubai, modern, sophisticated, 8k, photorealistic`),
        heygen.generateVideo(keyword)
      ]);

      let gptParsed = {};
      try {
        gptParsed = JSON.parse(textResponse.choices[0].message.content || '{}');
      } catch (jsonErr) {
        logger.error(`[${requestId}] Failed to parse GPT-4o JSON: ${jsonErr.message}`);
        throw new Error("Malformed JSON from GPT-4o");
      }

      rawContent = {
        ...gptParsed,
        hero_image_url: imageResponse?.url || "https://images.unsplash.com/photo-1582268494924-a7408f607106?auto=format&fit=crop&w=800&q=80",
        video_url: videoResponse?.url,
        testimonials: claudeParsedTestimonials,
      };

      const validatedContent = LandingPageSchema.parse(rawContent);
      logger.info(`[${requestId}] Successfully generated & validated content.`);
      return validatedContent;

    } catch (err) {
      logger.error(`[${requestId}] AI content gen/validation failed (Attempt ${attempts + 1}): ${err.message || err}`);
      attempts++;
      if (attempts < MAX_ATTEMPTS) {
        await new Promise(resolve => setTimeout(resolve, 2000 * attempts));
      }
    }
  }

  logger.error(`[${requestId}] All AI generation attempts failed. Serving fallback.`);
  return LandingPageSchema.parse({
    headline: `Experience Unparalleled Luxury Renovations in Dubai`,
    subheadline: `Bespoke design and meticulous execution for discerning clients.`,
    cta: `Schedule a Consultation`,
    whatsapp_message: `Hi, I'm interested in luxury renovation services in Dubai. Can we discuss?`,
    testimonials: [
      { name: "Satisfied Client", quote: "Our villa transformation was seamless and spectacular. Highly recommend!", rating: 5, project_type: "Full Villa Renovation" }
    ],
    hero_image_url: "https://images.unsplash.com/photo-1582268494924-a7408f607106?auto=format&fit=crop&w=800&q=80",
    image_alt_text: "Luxurious villa interior design in Dubai",
    meta_title: "Dubai Luxury Renovations | Elite Home Transformations",
    meta_description: "Discover bespoke luxury renovations for villas & apartments in Dubai. Leading design and build firm."
  });
}

// ===== ROUTES =====

// Health check
app.get('/ping', (req, res) => {
  res.json({ success: true, status: "ok", timestamp: Date.now(), requestId: req.requestId });
});

// Personalized Landing Content
app.get('/api/personalize', aiLimiter, async (req, res) => {
  const keyword = req.query.keyword?.toString() || 'luxury renovation dubai';
  const variant = variantManager.getVariant(req);
  const cacheKey = `personalize:${keyword}:${variant}`;
  const requestId = req.requestId;

  try {
    const cached = await cache.get(cacheKey);
    if (cached) {
      logger.info(`[${requestId}] Cache HIT for ${cacheKey}`);
      return res.json({ success: true, ...cached, cache: "hit", variant, requestId });
    }
    logger.info(`[${requestId}] Cache MISS for ${cacheKey}. Generating...`);
    const content = await generateLandingContent(keyword, variant, requestId);
    await cache.set(cacheKey, content, 21600); // 6 hours
    res.json({ success: true, ...content, cache: "miss", variant, requestId });
  } catch (err) {
    logger.error(`[${requestId}] Error in /api/personalize: ${err.message}`);
    res.status(500).json({
      success: false,
      error: "Failed to personalize content. Please try again.",
      requestId,
      details: NODE_ENV === 'development' ? err.message : undefined,
      fallback_content: {
        headline: "Luxury Renovations in Dubai",
        subheadline: "Your dream home, meticulously crafted.",
        cta: "Contact Us Now",
        whatsapp_message: "Hi, I need help with a renovation.",
        testimonials: [{ name: "Client", quote: "Exceptional service.", rating: 5, project_type: "General Inquiry" }],
        hero_image_url: "https://images.unsplash.com/photo-1574676571590-761d1e4c3a0b?q=80&w=1920&auto=format&fit=crop&ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
        image_alt_text: "Luxurious modern home interior",
        meta_title: "Luxury Renovations Dubai",
        meta_description: "Leading luxury renovation company in Dubai."
      }
    });
  }
});

// High-conversion Lead Submission
app.post('/api/leads', async (req, res) => {
  const requestId = req.requestId;
  try {
    const validatedLead = LeadSchema.parse(req.body);
    logger.info(`[${requestId}] Received lead: ${validatedLead.phone} (${validatedLead.source})`);
    // Process async, but respond immediately for best UX
    leadProcessor.processLead(validatedLead)
      .then(() => logger.info(`[${requestId}] Lead processed.`))
      .catch(e => logger.error(`[${requestId}] Lead process error: ${e.message}`));
    res.json({ success: true, message: "Lead submitted and being processed.", requestId });
  } catch (err) {
    if (err instanceof z.ZodError) {
      logger.warn(`[${requestId}] Lead validation failed:`, err.errors);
      return res.status(400).json({ success: false, error: "Invalid lead data.", details: err.errors, requestId });
    }
    logger.error(`[${requestId}] Lead submission error: ${err.message}`);
    res.status(500).json({ success: false, error: "Failed to submit lead. Please try again.", requestId });
  }
});

// ===== SERVER START =====
app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT} in ${NODE_ENV} mode`);
  logger.info(`REDIS_URL: ${REDIS_URL ? 'Configured' : 'NOT CONFIGURED'}`);
});

// ===== GRACEFUL SHUTDOWN =====
process.on('SIGTERM', async () => {
  logger.info('SIGTERM signal received. Shutting down gracefully.');
  await redisClient.quit();
  logger.info('Redis client disconnected.');
  process.exit(0);
});
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
process.on('uncaughtException', (error) => {
  logger.fatal('Uncaught Exception:', error);
  process.exit(1);
});
