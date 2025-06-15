import { z } from 'zod';

export const LandingPageSchema = z.object({
  headline: z.string().min(10).max(80),
  subheadline: z.string().min(10).max(120),
  cta: z.string().min(5).max(40),
  faqs: z.array(z.string().min(10)).min(3).max(6),
  whatsapp_message: z.string().min(10),
  generated_image_url: z.string().url(),
  // add more fields as needed
});
