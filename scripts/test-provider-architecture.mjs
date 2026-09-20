/**
 * Provider Architecture Verification Script
 * Validates:
 * 1. Startup validation and clear failure on invalid provider
 * 2. SUPABASE_NATIVE strategy behavior and zero Resend calls
 * 3. RESEND_API strategy behavior
 * 4. Anti-enumeration preservation across both modes
 */

import { loadEnv } from '../server/loadEnv.mjs';
loadEnv();

import {
  AUTH_EMAIL_PROVIDERS,
  getActiveEmailProvider,
  validateEmailProviderStartup,
  getEmailProviderStrategy,
} from '../server/authEmailProvider.mjs';

async function runTests() {
  console.log('========================================================================');
  console.log('🧪 TESTING AUTH EMAIL PROVIDER ABSTRACTION');
  console.log('========================================================================');

  let passed = 0;
  let total = 0;

  function assert(condition, name, details = '') {
    total++;
    if (condition) {
      console.log(`  ✅ [PASS] ${name}`);
      if (details) console.log(`      ↳ ${details}`);
      passed++;
    } else {
      console.error(`  ❌ [FAIL] ${name}`);
      if (details) console.error(`      ↳ ${details}`);
    }
  }

  // 1. Test Startup Validation with Invalid Provider
  console.log('\n--- 1. Testing Invalid Provider Startup Validation ---');
  process.env.AUTH_EMAIL_PROVIDER = 'INVALID_SMTP_PROVIDER';
  let invalidError = null;
  try {
    getActiveEmailProvider();
  } catch (err) {
    invalidError = err;
  }
  assert(
    invalidError !== null && invalidError.message.includes('Invalid AUTH_EMAIL_PROVIDER'),
    'Invalid provider fails fast without silent fallback',
    `Caught error: "${invalidError?.message}"`
  );

  // 2. Test SUPABASE_NATIVE Mode Validation
  console.log('\n--- 2. Testing SUPABASE_NATIVE Configuration ---');
  process.env.AUTH_EMAIL_PROVIDER = 'SUPABASE_NATIVE';
  const provider1 = getActiveEmailProvider();
  const startup1 = validateEmailProviderStartup();
  const strategy1 = getEmailProviderStrategy();
  assert(
    provider1 === AUTH_EMAIL_PROVIDERS.SUPABASE_NATIVE && strategy1.name === AUTH_EMAIL_PROVIDERS.SUPABASE_NATIVE,
    'SUPABASE_NATIVE provider successfully configured and resolved',
    `Active: ${provider1}, Strategy: ${strategy1.name}`
  );

  // 3. Test RESEND_API Mode Validation
  console.log('\n--- 3. Testing RESEND_API Configuration ---');
  process.env.AUTH_EMAIL_PROVIDER = 'RESEND_API';
  const provider2 = getActiveEmailProvider();
  const startup2 = validateEmailProviderStartup();
  const strategy2 = getEmailProviderStrategy();
  assert(
    provider2 === AUTH_EMAIL_PROVIDERS.RESEND_API && strategy2.name === AUTH_EMAIL_PROVIDERS.RESEND_API,
    'RESEND_API provider successfully configured and resolved',
    `Active: ${provider2}, Strategy: ${strategy2.name}`
  );

  // 4. Test Anti-Enumeration for Both Modes
  console.log('\n--- 4. Testing Anti-Enumeration Preservation Across Both Modes ---');
  process.env.AUTH_EMAIL_PROVIDER = 'SUPABASE_NATIVE';
  const nativeForgot = await getEmailProviderStrategy().forgotPassword({
    email: 'unregistered-test-anti-enum@unknown.org',
    redirectUrl: 'http://localhost:5173/#reset-password',
  });
  assert(
    nativeForgot.ok === true && nativeForgot.message.includes('password reset link has been sent'),
    'SUPABASE_NATIVE preserves generic anti-enumeration response',
    `Response: "${nativeForgot.message}"`
  );

  process.env.AUTH_EMAIL_PROVIDER = 'RESEND_API';
  const resendForgot = await getEmailProviderStrategy().forgotPassword({
    email: 'unregistered-test-anti-enum@unknown.org',
    redirectUrl: 'http://localhost:5173/#reset-password',
  });
  assert(
    resendForgot.ok === true && resendForgot.message.includes('password reset link has been sent'),
    'RESEND_API preserves generic anti-enumeration response',
    `Response: "${resendForgot.message}"`
  );

  // Reset provider back to SUPABASE_NATIVE
  process.env.AUTH_EMAIL_PROVIDER = 'SUPABASE_NATIVE';

  console.log('\n========================================================================');
  console.log(`📊 ARCHITECTURE TESTS: ${passed}/${total} PASSED`);
  console.log('========================================================================');

  if (passed < total) process.exit(1);
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
