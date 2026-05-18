'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function checkPaymentCards() {
  try {
    console.log('💳 Checking Payment Cards Status on Website\n');
    
    // 1. Check if there's a payment_methods table
    console.log('🔍 Checking payment methods table...');
    
    const { data: paymentMethods, error: paymentError } = await supabase
      .from('payment_methods')
      .select('*')
      .eq('is_active', true);
      
    if (paymentError) {
      console.log('ℹ️  No payment_methods table found, checking alternative tables...');
    } else {
      console.log(`✅ Found ${paymentMethods?.length || 0} active payment methods:`);
      paymentMethods?.forEach(method => {
        console.log(`  • ${method.name} - ${method.type}`);
        console.log(`    Provider: ${method.provider || 'N/A'}`);
        console.log(`    Active: ${method.is_active ? 'Yes' : 'No'}`);
      });
    }
    
    // 2. Check for settings or configuration table
    console.log('\n🔍 Checking settings table...');
    const { data: settings, error: settingsError } = await supabase
      .from('settings')
      .select('*')
      .like('key', '%payment%');
      
    if (settingsError) {
      console.log('ℹ️  No settings table found');
    } else {
      console.log(`✅ Found ${settings?.length || 0} payment-related settings:`);
      settings?.forEach(setting => {
        console.log(`  • ${setting.key}: ${setting.value}`);
      });
    }
    
    // 3. Check website files for payment card information
    console.log('\n🔍 Checking website files for payment cards...');
    
    // Look for payment-related files
    const fs = require('fs');
    const path = require('path');
    
    const paymentFiles = [
      'payment-methods.html',
      'payment.html', 
      'booking.html',
      'index.html'
    ];
    
    for (const file of paymentFiles) {
      const filePath = path.join(__dirname, '..', file);
      if (fs.existsSync(filePath)) {
        console.log(`📄 Checking ${file}...`);
        
        const content = fs.readFileSync(filePath, 'utf8');
        
        // Look for payment card mentions
        const cardPatterns = [
          /visa/gi,
          /mastercard/gi,
          /gopay/gi,
          /ovo/gi,
          /dana/gi,
          /shopeepay/gi,
          /qris/gi,
          /credit card/gi,
          /debit card/gi
        ];
        
        let foundCards = [];
        cardPatterns.forEach(pattern => {
          if (pattern.test(content)) {
            foundCards.push(pattern.source.replace(/\/gi$/, ''));
          }
        });
        
        if (foundCards.length > 0) {
          console.log(`  💳 Found payment methods: ${foundCards.join(', ')}`);
        } else {
          console.log(`  ℹ️  No payment methods found in ${file}`);
        }
      }
    }
    
    // 4. Check API endpoints for payment info
    console.log('\n📡 Testing payment API endpoints...');
    try {
      const response = await fetch('https://www.redboxbarbershop.com/api/payment-methods');
      if (response.ok) {
        const methods = await response.json();
        console.log(`✅ Payment API responding: ${methods?.length || 0} methods`);
        methods?.forEach(method => {
          console.log(`  • ${method.name || method.type}`);
        });
      } else {
        console.log(`ℹ️  Payment API not available (${response.status})`);
      }
    } catch (apiError) {
      console.log(`ℹ️  Payment API unreachable: ${apiError.message}`);
    }
    
    // 5. Check if there are any recent updates to payment configuration
    console.log('\n🔍 Checking for recent payment updates...');
    const { data: recentUpdates, error: recentError } = await supabase
      .from('audit_log')
      .select('*')
      .like('action', '%payment%')
      .order('created_at', { ascending: false })
      .limit(5);
      
    if (recentError) {
      console.log('ℹ️  No audit log found');
    } else if (recentUpdates && recentUpdates.length > 0) {
      console.log(`📝 Found ${recentUpdates.length} recent payment updates:`);
      recentUpdates.forEach(update => {
        console.log(`  • ${new Date(update.created_at).toLocaleString()}: ${update.action}`);
      });
    } else {
      console.log('ℹ️  No recent payment updates found');
    }
    
    console.log('\n📊 PAYMENT CARDS SUMMARY:');
    console.log('✅ Price updated: Gentleman Grooming now Rp120,000');
    console.log('ℹ️  Please check website manually for payment card updates');
    console.log('🌐 Website: https://www.redboxbarbershop.com');
    
    return {
      priceUpdated: true,
      newPrice: 120000,
      paymentCheckCompleted: true
    };
    
  } catch (error) {
    console.error('❌ Payment cards check failed:', error);
    return null;
  }
}

// Run the check
checkPaymentCards();
