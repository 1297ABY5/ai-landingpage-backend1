// utils/schemas.js
import { z } from 'zod';

export const LandingPageSchema = z.object({
  headline: z.string().min(10).max(80),
  subheadline: z.string().min(15).max(120),
  
  cta: z.string().min(5).max(35),
  whatsapp_message: z.string().min(10).max(200),
  
  testimonials: z.array(z.object({
    name: z.string().min(2).max(50),
    quote: z.string().min(20).max(300),
    rating: z.number().min(1).max(5).int(),
    project_type: z.string().optional(),
  })).length(3, "Must provide exactly 3 testimonials"),
  
  hero_image_url: z.string().url("Invalid hero image URL"),
  image_alt_text: z.string().min(5).max(100),
  video_url: z.string().url("Invalid video URL").optional(),
  video_caption: z.string().max(100).optional(),
  
  meta_title: z.string().min(10).max(60),
  meta_description: z.string().min(20).max(160),
}).strict("LandingPageSchema contains unexpected fields. Ensure AI output matches precisely.");

export const LeadSchema = z.object({
  phone: z.string().min(8, "Phone number is required and must be at least 8 digits.").max(20),
  name: z.string().min(2).max(100).optional(),
  email: z.string().email("Invalid email address.").optional(),
  message: z.string().max(500).optional(),
  source: z.string().optional(),
  variant: z.string().optional(),
}).strict("LeadSchema contains unexpected fields.");
