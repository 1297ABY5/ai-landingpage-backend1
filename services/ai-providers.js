// services/ai-providers.js
import OpenAI from 'openai';
import { Anthropic } from '@anthropic-ai/sdk';
import logger from '../utils/logger.js'; // Adjusted path

// --- OpenAI ---
export class OpenAIProvider {
  constructor(apiKey) {
    this.client = new OpenAI({ apiKey });
  }

  async chat.completions.create(params) {
    try {
      const response = await this.client.chat.completions.create(params);
      logger.info(`OpenAI call successful. Model: ${params.model}`);
      return response;
    } catch (error) {
      logger.error(`OpenAI call failed: ${error.message}`);
      throw new Error(`OpenAI API error: ${error.message}`);
    }
  }
}

// --- Claude ---
export class ClaudeProvider {
  constructor(apiKey) {
    this.client = new Anthropic({ apiKey });
  }

  async generate(params) {
    try {
      const response = await this.client.messages.create(params);
      logger.info(`Claude call successful. Model: ${params.model}`);
      const textContent = response.content.map(block => block.text).join('\n');
      return { content: textContent };
    } catch (error) {
      logger.error(`Claude call failed: ${error.message}`);
      throw new Error(`Claude API error: ${error.message}`);
    }
  }
}

// --- Midjourney (Conceptual API Wrapper) ---
export class MidjourneyProvider {
  constructor(apiKey) {
    this.apiKey = apiKey;
  }

  async generate(prompt) {
    logger.info(`Midjourney generation requested for: "${prompt}"`);
    await new Promise(resolve => setTimeout(resolve, 3000));
    const imageUrl = `https://generated.images.com/midjourney-luxury-${Date.now()}.jpg`;
    logger.info(`Midjourney image generated: ${imageUrl}`);
    return { url: imageUrl };
  }
}

// --- HeyGen (Conceptual API Wrapper) ---
export class HeyGenProvider {
  constructor(apiKey) {
    this.apiKey = apiKey;
  }

  async generateVideo(keyword) {
    logger.info(`HeyGen video generation requested for: "${keyword}"`);
    await new Promise(resolve => setTimeout(resolve, 5000));
    const videoUrl = `https://generated.videos.com/heygen-luxury-${Date.now()}.mp4`;
    logger.info(`HeyGen video generated: ${videoUrl}`);
    return { url: videoUrl };
  }
}
