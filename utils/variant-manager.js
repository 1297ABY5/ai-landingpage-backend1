// utils/variant-manager.js
import logger from './logger.js'; // Adjusted path
import crypto from 'crypto';

export class VariantManager {
  constructor(redisClient) {
    this.redis = redisClient;
    this.variants = {
      'control': 0.5,
      'variant-1': 0.5,
    };
    logger.info(`A/B testing variants initialized: ${JSON.stringify(this.variants)}`);
  }

  getVariant(req) {
    const userId = req.ip || 'anonymous';
    const hash = crypto.createHash('md5').update(userId).digest('hex');
    const hashValue = parseInt(hash.substring(0, 8), 16);

    let cumulativeWeight = 0;
    const totalWeight = Object.values(this.variants).reduce((sum, weight) => sum + weight, 0);
    const randomNumber = (hashValue / 0xFFFFFFFF) * totalWeight;

    for (const variantName in this.variants) {
      cumulativeWeight += this.variants[variantName];
      if (randomNumber <= cumulativeWeight) {
        logger.debug(`Assigned variant '${variantName}' to user ${userId}`);
        return variantName;
      }
    }
    logger.warn(`Could not assign variant for user ${userId}. Defaulting to 'control'.`);
    return 'control';
  }
}
