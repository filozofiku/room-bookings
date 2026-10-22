import { loadEnv } from 'vite';
import { writeFileSync } from 'node:fs';
const env = loadEnv('production', process.cwd(), 'VITE_FIREBASE_');
const config = Object.fromEntries(['API_KEY','AUTH_DOMAIN','PROJECT_ID','APP_ID','MESSAGING_SENDER_ID'].map((key,i) => [
  ['apiKey','authDomain','projectId','appId','messagingSenderId'][i], process.env[`VITE_FIREBASE_${key}`] || env[`VITE_FIREBASE_${key}`]
]));
if (!config.apiKey || !config.projectId || !config.appId) throw new Error('Configure Firebase web values in .env first.');
writeFileSync(new URL('../public-schedule/firebase-config.js', import.meta.url), `// Public Firebase web configuration; contains no Admin credentials.\nexport default ${JSON.stringify(config,null,2)};\n`);
console.log('Wrote public-schedule/firebase-config.js');
