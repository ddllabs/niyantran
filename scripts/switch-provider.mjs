import fs from 'fs';

const targetProvider = process.argv[2] || 'SUPABASE_NATIVE';
if (targetProvider !== 'SUPABASE_NATIVE' && targetProvider !== 'RESEND_API') {
  console.error('Invalid provider:', targetProvider);
  process.exit(1);
}

for (const file of ['.env', 'backend/.env']) {
  if (fs.existsSync(file)) {
    let content = fs.readFileSync(file, 'utf8');
    content = content.replace(/AUTH_EMAIL_PROVIDER=["'][^"']+["']/, `AUTH_EMAIL_PROVIDER="${targetProvider}"`);
    fs.writeFileSync(file, content, 'utf8');
    console.log(`Updated ${file} -> AUTH_EMAIL_PROVIDER="${targetProvider}"`);
  }
}

try {
  const res = await fetch('http://localhost:5173/api/auth/provider');
  const data = await res.json();
  console.log('Live server provider status:', data);
} catch (err) {
  console.log('Live server not currently reachable:', err.message);
}
