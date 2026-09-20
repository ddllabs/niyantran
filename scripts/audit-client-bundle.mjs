import fs from 'fs';
import path from 'path';

const distDir = path.resolve(process.cwd(), 'dist', 'assets');
const files = fs.readdirSync(distDir);

console.log('========================================================================');
console.log('🔒 CLIENT BUNDLE SECURITY AUDIT');
console.log('========================================================================');
console.log(`Scanning assets in: ${distDir}`);

const forbiddenPatterns = [
  { name: 'RESEND_API_KEY value', pattern: /re_[a-zA-Z0-9_-]{20,}/ },
  { name: 'SUPABASE_SERVICE_ROLE_KEY string identifier', pattern: /SUPABASE_SERVICE_ROLE_KEY/ },
  { name: 'service_role JWT claim', pattern: /service_role/ },
  { name: 'getSupabaseAdmin function call', pattern: /getSupabaseAdmin/ },
  { name: 'Resend SDK/server imports', pattern: /from ['"]resend['"]/ },
  { name: 'api.resend.com/emails endpoint in client', pattern: /api\.resend\.com\/emails/ },
];

let leaksFound = 0;

for (const file of files) {
  if (!file.endsWith('.js') && !file.endsWith('.css')) continue;
  const filePath = path.join(distDir, file);
  const content = fs.readFileSync(filePath, 'utf8');

  console.log(`\nInspecting asset: ${file} (${Math.round(content.length / 1024)} KB)`);

  for (const check of forbiddenPatterns) {
    if (check.pattern.test(content)) {
      console.error(`  ❌ [LEAK DETECTED] ${check.name} found in ${file}!`);
      leaksFound++;
    } else {
      console.log(`  ✅ [CLEAN] No ${check.name}`);
    }
  }
}

console.log('\n========================================================================');
if (leaksFound === 0) {
  console.log('🎉 AUDIT PASSED: ZERO SECRETS OR SERVER IMPLEMENTATIONS DETECTED IN CLIENT ASSETS.');
} else {
  console.error(`🚨 AUDIT FAILED: ${leaksFound} POTENTIAL LEAKS DETECTED!`);
  process.exit(1);
}
console.log('========================================================================');
