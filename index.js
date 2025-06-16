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
              role: "user",
              content: `Generate 3 highly believable testimonials for a luxury "${keyword}" service in Dubai as a JSON array. Each testimonial must have:
- name (string)
- quote (string, minimum 25 characters)
- rating (number 1-5)

Example format:
[
  {
    "name": "Client Name",
    "quote": "Detailed testimonial text that is at least 25 characters long...",
    "rating": 5
  }
]

Return only the JSON array with exactly 3 testimonials.`
            }],
            max_tokens: 1000
          });

          // Parse and validate testimonials
          claudeTestimonials = JSON.parse(resp.content || '[]');
          
          // Ensure testimonials meet requirements
          claudeTestimonials = claudeTestimonials.slice(0, 3).map(t => ({
            name: t.name || `Client ${String.fromCharCode(65 + Math.floor(Math.random() * 26))}`,
            quote: t.quote && t.quote.length >= 20 
              ? t.quote 
              : "This service exceeded all our expectations with their attention to detail and quality craftsmanship.",
            rating: typeof t.rating === 'number' 
              ? Math.min(Math.max(t.rating, 1), 5) 
              : 5
          }));

          // Fill in any missing testimonials
          while (claudeTestimonials.length < 3) {
            claudeTestimonials.push({
              name: `Client ${String.fromCharCode(65 + claudeTestimonials.length)}`,
              quote: "The quality and professionalism was outstanding from start to finish. Highly recommended!",
              rating: 5
            });
          }

          await cache.set(testimonialsCacheKey, claudeTestimonials, 21600);
        } catch (err) {
          logger.warn(`[${requestId}] Claude failed—using fallback testimonial. Error: ${err.message}`);
          claudeTestimonials = [
            { 
              name: "Sheikh Ahmed", 
              quote: "The renovation transformed our palace beyond expectations. Every detail was perfect.", 
              rating: 5 
            },
            { 
              name: "Mr. Johnson", 
              quote: "Working with this team was a pleasure from start to finish. The quality is unmatched.", 
              rating: 5 
            },
            { 
              name: "Mrs. Al-Farsi", 
              quote: "They delivered our dream home on time and on budget. Highly recommended for luxury projects.", 
              rating: 5 
            }
          ];
        }
      }

      // Parallel AI calls with stricter GPT prompt
      const [textResp, imageResp, videoResp] = await Promise.all([
        openai.generate({
          model: "gpt-4o",
          messages: [
            { 
              role: "system", 
              content: `You are a Dubai luxury marketing expert. Generate JSON for a landing page about "${keyword}" with these EXACT fields:
- headline (string, 5-8 words)
- subheadline (string, 8-12 words)
- cta (string, 2-4 words)
- whatsapp_message (string, 8-15 words)
- hero_image_url (string)
- image_alt_text (string, 5-8 words)
- meta_title (string, max 60 chars)
- meta_description (string, max 160 chars)
- video_url (string)

Important rules:
1. Only include these fields
2. Testimonials will be added separately
3. meta_title must be <= 60 characters
4. meta_description must be <= 160 characters
5. Return valid JSON with no extra fields`
            },
            { 
              role: "user", 
              content: `Create landing page content for luxury ${keyword} services in Dubai` 
            }
          ],
          response_format: { type: "json_object" },
          temperature: 0.7
        }),
        mj.generate(`ultra-luxury ${keyword} in Dubai, modern, sophisticated, photorealistic, 8k`),
        heygen.generateVideo(keyword)
      ]);

      // Parse and validate GPT response
      let gptParsed = {};
      try {
        gptParsed = JSON.parse(textResp.choices[0].message.content || '{}');
        
        // Ensure critical fields exist and meet requirements
        const defaultMetaTitle = `Luxury ${keyword} in Dubai | Premium Services`;
        const defaultMetaDesc = `Experience world-class ${keyword} services in Dubai. Premium quality with exceptional attention to detail.`;

        gptParsed = {
          headline: gptParsed.headline || `Premium ${keyword} Services in Dubai`,
          subheadline: gptParsed.subheadline || `Transform your space with our luxury ${keyword} solutions`,
          cta: gptParsed.cta || "Book Consultation",
          whatsapp_message: gptParsed.whatsapp_message || `Hi, I'm interested in ${keyword} services`,
          hero_image_url: gptParsed.hero_image_url || "",
          image_alt_text: gptParsed.image_alt_text || `Luxury ${keyword} example`,
          meta_title: (gptParsed.meta_title || defaultMetaTitle).slice(0, 60),
          meta_description: (gptParsed.meta_description || defaultMetaDesc).slice(0, 160),
          video_url: gptParsed.video_url || ""
        };
      } catch (jsonErr) {
        throw new Error(`Malformed JSON from GPT-4o: ${jsonErr.message}`);
      }

      rawContent = {
        ...gptParsed,
        hero_image_url: imageResp.url || "https://images.unsplash.com/photo-1582268494924-a7408f607106?auto=format&fit=crop&w=800&q=80",
        video_url: videoResp.url || "https://example.com/fallback-video.mp4",
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

  // Final fallback content that passes all validations
  logger.error(`[${requestId}] All attempts failed—serving hardcoded fallback.`);
  return LandingPageSchema.strict().parse({
    headline: "Elite Dubai Luxury Renovations",
    subheadline: "Transforming spaces with unparalleled craftsmanship and design",
    cta: "Book Consultation",
    whatsapp_message: "Hello, I'm interested in your luxury renovation services",
    testimonials: [
      { 
        name: "Sheikh Ahmed", 
        quote: "The renovation transformed our palace beyond expectations. Every detail was perfect.", 
        rating: 5 
      },
      { 
        name: "Mr. Johnson", 
        quote: "Working with this team was a pleasure from start to finish. The quality is unmatched.", 
        rating: 5 
      },
      { 
        name: "Mrs. Al-Farsi", 
        quote: "They delivered our dream home on time and on budget. Highly recommended for luxury projects.", 
        rating: 5 
      }
    ],
    hero_image_url: "https://images.unsplash.com/photo-1582268494924-a7408f607106?auto=format&fit=crop&w=800&q=80",
    image_alt_text: "Luxury Dubai villa interior",
    meta_title: "Luxury Renovations Dubai | Premium Home Transformations",
    meta_description: "Experience world-class luxury renovations in Dubai with our premium service. Exceptional quality and attention to detail for discerning clients.",
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
          { 
            name: "Client", 
            quote: "The service was absolutely fantastic and exceeded all our expectations.", 
            rating: 5 
          },
          { 
            name: "Business Owner", 
            quote: "Their attention to detail and quality craftsmanship is unmatched in Dubai.", 
            rating: 5 
          },
          { 
            name: "Homeowner", 
            quote: "From design to completion, the entire process was seamless and professional.", 
            rating: 5 
          }
        ],
        hero_image_url: "https://images.unsplash.com/photo-1582268494924-a7408f607106?auto=format&fit=crop&w=800&q=80",
        image_alt_text: "Luxury interior",
        meta_title: "Luxury Renovations Dubai",
        meta_description: "Premium renovation services in Dubai with exceptional quality and attention to detail",
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
