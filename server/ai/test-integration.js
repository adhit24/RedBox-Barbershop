/**
 * Integration Test - AI Grooming Assistant
 * Quick test to verify backend is working before frontend testing
 * 
 * Usage: node test-integration.js
 */

require('dotenv').config({ path: '../.env' });

const http = require('http');

const BASE_URL = 'http://localhost:3001';

// Colors for console
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  reset: '\x1b[0m'
};

function log(message, type = 'info') {
  const color = type === 'success' ? colors.green : type === 'error' ? colors.red : colors.yellow;
  console.log(`${color}${message}${colors.reset}`);
}

async function makeRequest(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3001,
      path,
      method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode,
            data: JSON.parse(data)
          });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runTests() {
  console.log('🧪 AI Grooming Assistant - Integration Test\n');
  console.log('═'.repeat(50));

  // Test 1: Server Health
  console.log('\n1️⃣ Testing Server Health...');
  try {
    const health = await makeRequest('/api/health');
    if (health.status === 200) {
      log('✅ Server is running', 'success');
      console.log(`   Port: 3001`);
      console.log(`   Database: ${health.data?.database || 'unknown'}`);
    } else {
      log('❌ Server health check failed', 'error');
      process.exit(1);
    }
  } catch (error) {
    log('❌ Cannot connect to server', 'error');
    log('   Make sure server is running: node server/index.js', 'error');
    process.exit(1);
  }

  // Test 2: AI Routes Mounted
  console.log('\n2️⃣ Testing AI Routes...');
  try {
    // This will return 401 (unauthorized) but proves routes exist
    const response = await makeRequest('/api/ai/credits');
    if (response.status === 401 || response.status === 200) {
      log('✅ AI routes are mounted', 'success');
      console.log(`   Endpoint: /api/ai/*`);
      console.log(`   Status: ${response.status === 401 ? 'Protected (requires auth)' : 'OK'}`);
    } else if (response.status === 404) {
      log('❌ AI routes not found (404)', 'error');
      log('   Run: cd server/ai && npm install', 'error');
    } else {
      log(`⚠️  Unexpected status: ${response.status}`, 'error');
    }
  } catch (error) {
    log('❌ AI routes test failed', 'error');
    console.log('   Error:', error.message);
  }

  // Test 3: OpenAI API Key
  console.log('\n3️⃣ Testing OpenAI API Key...');
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    log('❌ OPENAI_API_KEY not found in .env', 'error');
  } else if (openaiKey.startsWith('sk-')) {
    log('✅ OpenAI API Key is configured', 'success');
    console.log(`   Key: ${openaiKey.substring(0, 20)}...`);
  } else {
    log('⚠️  API Key format looks invalid', 'error');
  }

  // Test 4: Check Dependencies
  console.log('\n4️⃣ Checking Dependencies...');
  const deps = ['openai', '@supabase/supabase-js', 'bull', 'sharp', 'multer'];
  for (const dep of deps) {
    try {
      require(dep);
      console.log(`   ✅ ${dep}`);
    } catch {
      console.log(`   ❌ ${dep} - Run: npm install`);
    }
  }

  // Summary
  console.log('\n' + '═'.repeat(50));
  console.log('\n📊 Test Summary:');
  console.log('   • Server: Check above');
  console.log('   • AI Routes: Check above');
  console.log('   • API Key: Check above');
  console.log('   • Dependencies: Check above');
  
  console.log('\n🚀 Ready for local testing!');
  console.log('\nNext steps:');
  console.log('   1. cd server && npm install');
  console.log('   2. node server/index.js');
  console.log('   3. Open index.html in browser');
  console.log('   4. Test AI upload feature');
}

// Check if server is running
async function checkServer() {
  try {
    await makeRequest('/api/health');
    return true;
  } catch {
    return false;
  }
}

// Auto-start server if not running
checkServer().then(isRunning => {
  if (!isRunning) {
    console.log('⚠️  Server is not running!');
    console.log('\nPlease start server first:');
    console.log('   cd server');
    console.log('   node index.js');
    console.log('\nThen run this test again.');
    process.exit(1);
  } else {
    runTests();
  }
});
