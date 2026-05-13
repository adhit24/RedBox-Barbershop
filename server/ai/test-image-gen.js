/**
 * Test Image Generation only
 * Tests gpt-image-2-2026-04-21 via Responses API
 * Run: node test-image-gen.js
 */

require('dotenv').config({ path: '../.env' });

const { OpenAI } = require('openai');
const fs = require('fs');
const path = require('path');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const PROMPT = `Generate a photorealistic portrait of a young Indonesian man in his mid-20s 
getting a fresh modern haircut at a premium barbershop. Show a "before and after" style image — 
left side showing the original look, right side showing a clean Two-Block Korean style haircut 
with fade sides. Professional studio lighting, sharp detail, cinematic quality.`;

async function testImageGeneration() {
  console.log('🖼️  Testing gpt-image-2-2026-04-21 image generation...\n');
  console.log('Prompt:', PROMPT.trim());
  console.log('\n⏳ Generating image (may take 15-30 seconds)...\n');

  const startTime = Date.now();

  try {
    // gpt-image-2 via Images API (native, not Responses API)
    const response = await openai.images.generate({
      model: 'gpt-image-2-2026-04-21',
      prompt: PROMPT,
      n: 1,
      size: '1024x1024'
    });

    const elapsed = Date.now() - startTime;

    // gpt-image-2 returns b64_json by default
    const imageBase64 = response.data?.[0]?.b64_json;
    const imageUrl = response.data?.[0]?.url;
    if (!imageBase64) {
      console.log('❌ No image data in response.');
      console.log('Full response:', JSON.stringify(response, null, 2));
      return;
    }

    console.log(`✅ Image generated! (${elapsed}ms)`);

    // Save as PNG
    const outputDir = path.join(__dirname, 'test-results');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const outputPath = path.join(outputDir, 'generated-preview.png');
    fs.writeFileSync(outputPath, Buffer.from(imageBase64, 'base64'));

    console.log(`\n🎉 Image saved to: test-results/generated-preview.png`);
    console.log(`   Size: ${(Buffer.from(imageBase64, 'base64').length / 1024).toFixed(1)} KB`);
    console.log(`\n📂 Open file: ${outputPath}`);

  } catch (error) {
    const elapsed = Date.now() - startTime;
    console.error(`❌ Error after ${elapsed}ms:`, error.message);
    if (error.status) console.error('   HTTP Status:', error.status);
    if (error.code) console.error('   Error Code:', error.code);
  }
}

testImageGeneration();
