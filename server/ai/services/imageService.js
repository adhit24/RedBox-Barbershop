/**
 * Image Processing & Storage Service
 */

const sharp = require('sharp');
const { supabase } = require('../config/database');

const imageService = {
  
  // Process image with Sharp
  processImage: async (buffer) => {
    try {
      const processed = await sharp(buffer)
        .resize(1024, 1024, { 
          fit: 'inside',
          withoutEnlargement: true
        })
        .jpeg({
          quality: 85,
          progressive: true
        })
        .toBuffer();

      return processed;
    } catch (error) {
      console.error('Image processing error:', error);
      throw new Error('Failed to process image');
    }
  },

  // Upload to Supabase Storage
  uploadToStorage: async (buffer, path) => {
    try {
      const { data, error } = await supabase.storage
        .from('ai-images')
        .upload(path, buffer, {
          contentType: 'image/jpeg',
          cacheControl: '3600'
        });

      if (error) throw error;

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('ai-images')
        .getPublicUrl(path);

      return publicUrl;
    } catch (error) {
      console.error('Storage upload error:', error);
      throw new Error('Failed to upload to storage');
    }
  },

  // Delete from storage
  deleteFromStorage: async (url) => {
    try {
      const path = url.split('ai-images/')[1];
      if (!path) return;

      await supabase.storage
        .from('ai-images')
        .remove([path]);
    } catch (error) {
      console.error('Storage delete error:', error);
    }
  },

  // Download image for processing
  downloadImage: async (url) => {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to download image');
      
      const buffer = await response.arrayBuffer();
      return Buffer.from(buffer);
    } catch (error) {
      console.error('Download error:', error);
      throw error;
    }
  }
};

module.exports = imageService;
