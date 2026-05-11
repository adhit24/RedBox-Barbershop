/**
 * Local Test Script for AI Grooming Assistant
 * Run this to test OpenAI integration before deploying
 * 
 * Usage: node test-local.js
 */

require('dotenv').config({ path: '../.env' });

const aiService = require('./services/aiService');
const fs = require('fs');
const path = require('path');

// Test image URL (public test image - replace with your own)
const TEST_IMAGE_URL = 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&h=400&fit=crop';

async function runTests() {
  console.log('🧪 Testing AI Grooming Assistant...\n');
  
  // Test 1: API Key validation
  console.log('1️⃣ Testing API Key...');
  const connectionTest = await aiService.testConnection();
  
  if (!connectionTest.success) {
    console.error('❌ API Key invalid:', connectionTest.error);
    console.log('\n⚠️  Please check your OPENAI_API_KEY in .env file');
    process.exit(1);
  }
  
  console.log('✅ API Key valid!');
  console.log(`   Available models: ${connectionTest.availableModels}\n`);
  
  // Test 2: Face Analysis
  console.log('2️⃣ Testing Face Analysis...');
  console.log(`   Image: ${TEST_IMAGE_URL}`);
  
  try {
    const faceResult = await aiService.analyzeFace(TEST_IMAGE_URL);
    
    console.log('✅ Face Analysis completed!');
    console.log(`   Model: ${faceResult.model}`);
    console.log(`   Processing time: ${faceResult.processingTime}ms`);
    console.log(`   Estimated cost: $${faceResult.cost.toFixed(6)}`);
    console.log(`   Tokens used: ${faceResult.tokens}`);
    
    if (faceResult.analysis?.faceShape) {
      console.log(`   Detected face shape: ${faceResult.analysis.faceShape}`);
    }
    
    // Save result to file for inspection
    fs.writeFileSync(
      path.join(__dirname, 'test-results', 'face-analysis.json'),
      JSON.stringify(faceResult, null, 2)
    );
    console.log('   📄 Result saved to: test-results/face-analysis.json\n');
    
  } catch (error) {
    console.error('❌ Face Analysis failed:', error.message);
    console.log('\n');
  }
  
  // Test 3: Hairstyle Recommendation
  console.log('3️⃣ Testing Hairstyle Recommendation...');
  
  try {
    const hairResult = await aiService.recommendHairstyle(TEST_IMAGE_URL, {
      style: 'modern',
      ageRange: '25-35'
    });
    
    console.log('✅ Hairstyle Recommendation completed!');
    console.log(`   Model: ${hairResult.model}`);
    console.log(`   Processing time: ${hairResult.processingTime}ms`);
    console.log(`   Estimated cost: $${hairResult.cost.toFixed(6)}`);
    console.log(`   Recommendations: ${hairResult.recommendations?.length || 0} styles`);
    
    if (hairResult.recommendations?.[0]) {
      console.log(`   Top recommendation: ${hairResult.recommendations[0].name}`);
    }
    
    fs.writeFileSync(
      path.join(__dirname, 'test-results', 'hairstyle-rec.json'),
      JSON.stringify(hairResult, null, 2)
    );
    console.log('   📄 Result saved to: test-results/hairstyle-rec.json\n');
    
  } catch (error) {
    console.error('❌ Hairstyle Recommendation failed:', error.message);
    console.log('\n');
  }
  
  // Test 4: Outfit Recommendation
  console.log('4️⃣ Testing Outfit Recommendation...');
  
  try {
    const outfitResult = await aiService.recommendOutfit(TEST_IMAGE_URL, 'casual', 'tropical');
    
    console.log('✅ Outfit Recommendation completed!');
    console.log(`   Model: ${outfitResult.model}`);
    console.log(`   Processing time: ${outfitResult.processingTime}ms`);
    console.log(`   Estimated cost: $${outfitResult.cost.toFixed(6)}`);
    
    if (outfitResult.colorAnalysis?.skinTone) {
      console.log(`   Detected skin tone: ${outfitResult.colorAnalysis.skinTone}`);
    }
    
    fs.writeFileSync(
      path.join(__dirname, 'test-results', 'outfit-rec.json'),
      JSON.stringify(outfitResult, null, 2)
    );
    console.log('   📄 Result saved to: test-results/outfit-rec.json\n');
    
  } catch (error) {
    console.error('❌ Outfit Recommendation failed:', error.message);
    console.log('\n');
  }
  
  // Test 5: Combined Analysis (all-in-one)
  console.log('5️⃣ Testing Combined Analysis...');
  
  try {
    const combinedResult = await aiService.combinedAnalysis(TEST_IMAGE_URL);
    
    console.log('✅ Combined Analysis completed!');
    console.log(`   Model: ${combinedResult.model}`);
    console.log(`   Processing time: ${combinedResult.processingTime}ms`);
    console.log(`   Estimated cost: $${combinedResult.cost.toFixed(6)}`);
    
    fs.writeFileSync(
      path.join(__dirname, 'test-results', 'combined-analysis.json'),
      JSON.stringify(combinedResult, null, 2)
    );
    console.log('   📄 Result saved to: test-results/combined-analysis.json\n');
    
  } catch (error) {
    console.error('❌ Combined Analysis failed:', error.message);
    console.log('\n');
  }
  
  // Summary
  console.log('═'.repeat(50));
  console.log('📊 TEST SUMMARY');
  console.log('═'.repeat(50));
  console.log('All tests completed! Check test-results/ folder for detailed outputs.');
  console.log('\n📝 Next Steps:');
  console.log('   1. Review test results in test-results/ folder');
  console.log('   2. Verify JSON structure matches your requirements');
  console.log('   3. Test with your own images (replace TEST_IMAGE_URL)');
  console.log('   4. When ready, run: npm install (in ai/ folder)');
  console.log('   5. Then: node workers/aiWorker.js (to start queue)');
  console.log('\n🚀 Ready for May 16, 2026 deployment!');
}

// Create test-results directory if not exists
const resultsDir = path.join(__dirname, 'test-results');
if (!fs.existsSync(resultsDir)) {
  fs.mkdirSync(resultsDir, { recursive: true });
}

// Run tests
runTests().catch(error => {
  console.error('💥 Test suite failed:', error);
  process.exit(1);
});
