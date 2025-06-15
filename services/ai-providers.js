// services/ai-providers.js
import OpenAI from 'openai';
import { Anthropic } from '@anthropic-ai/sdk';
import logger from '../utils/logger.js'; // adjust path to your logger

// --- OpenAI ---
export class OpenAIProvider {
  constructor(apiKey) {
    this.client = new OpenAI({ apiKey });
  }
  /** 
   * @param {{model:string,messages:object[],temperature?:number,max_tokens?:number,response_format?:object}} params 
   * @returns OpenAI ChatCompletion response
   */
  async generate(params) {
    try {
      const response = await this.client.chat.completions.create(params);
      logger.info(`OpenAI call successful (model=${params.model})`);
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
  /**
   * @param {{model:string,messages:object[]}} params
   * @returns {{content:string}}
   */
  async generate(params) {
    try {
      // Anthropic SDK v0.23+ uses .complete or .messages.create
      const res = await this.client.messages.create({
        model: params.model,
        prompt: params.messages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n'),
        max_tokens_to_sample: 300,
        temperature: 0.7
      });
      logger.info(`Claude call successful (model=${params.model})`);
      return { content: res.completion };
    } catch (error) {
      logger.error(`Claude call failed: ${error.message}`);
      throw new Error(`Claude API error: ${error.message}`);
    }
  }
}

// --- Midjourney (stub, swap in your real API) ---
export class MidjourneyProvider {
  constructor(apiKey) {
    this.apiKey = apiKey;
  }
  /** @param {string} prompt */
  async generate(prompt) {
    logger.info(`Midjourney prompt: "${prompt}"`);
    // simulate network/image gen delay
    await new Promise(r => setTimeout(r, 3000));
    const url = `https://via.placeholder.com/1024?text=${encodeURIComponent(prompt)}`;
    logger.info(`Midjourney returned placeholder URL`);
    return { url };
  }
}

// --- HeyGen (stub, swap in your real API) ---
export class HeyGenProvider {
  constructor(apiKey) {
    this.apiKey = apiKey;
  }
  /** @param {string} keyword */
  async generateVideo(keyword) {
    logger.info(`HeyGen keyword: "${keyword}"`);
    // simulate video gen delay
    await new Promise(r => setTimeout(r, 5000));
    const url = `https://example.com/videos/heygen-${encodeURIComponent(keyword)}.mp4`;
    logger.info(`HeyGen returned placeholder video URL`);
    return { url };
  }
}
