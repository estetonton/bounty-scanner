const https = require('https');
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.GH_TOKEN;
const SEEN_FILE = path.join(__dirname, 'seen.json');
const POLL_INTERVAL = 5 * 60 * 1000;

let seen = new Set();
if (fs.existsSync(SEEN_FILE)) {
  try {
    const data = JSON.parse(fs.readFileSync(SEEN_FILE, 'utf8'));
    if (Array.isArray(data)) data.forEach(id => seen.add(id));
  } catch (e) {}
}

function saveSeen() {
  fs.writeFileSync(SEEN_FILE, JSON.stringify([...seen]), 'utf8');
}

function githubAPI(path) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.github.com',
      path,
      headers: {
        'User-Agent': 'bounty-scanner/1.0',
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': `Bearer ${TOKEN}`
      }
    };
    https.get(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        resolve(JSON.parse(data));
      });
    }).on('error', reject);
  });
}

function parseBountyAmount(title, body) {
  const text = `${title} ${body || ''}`;
  const patterns = [
    /\$(\d+(?:,\d{3})*(?:\.\d+)?)\s*(USDC|USD)?/i,
    /(\d+(?:\.\d+)?)\s*(USDC|USDT|ETH|BTC|SOL)/i,
    /bounty[:\s]+(\$?\d+(?:\.\d+)?)/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      let val = parseFloat(m[1].replace(/,/g, ''));
      if (m[2] === 'ETH' || m[2] === 'BTC') return { value: val, currency: m[2], usdEstimate: m[2] === 'ETH' ? val * 3500 : val * 95000 };
      return { value: val, currency: m[2] || 'USD', usdEstimate: val };
    }
  }
  return null;
}

function isJokeIssue(title, body) {
  const jokeKeywords = ['imaginary', 'xenonite', 'golden egg', 'butter', 'goose', 'hedgehog', 'magic beans', 'indoraptor', 'banana pudding'];
  const text = `${title} ${body || ''}`.toLowerCase();
  return jokeKeywords.some(k => text.includes(k));
}

async function scan() {
  try {
    console.log(`\n[${new Date().toISOString()}] Scanning for new bounty issues...`);

    const queries = [
      'label:bounty is:issue is:open sort:created-desc',
      'label:"good first issue" label:bounty is:issue is:open sort:created-desc',
    ];

    const allIssues = [];
    for (const q of queries) {
      const encoded = encodeURIComponent(q);
      const result = await githubAPI(`/search/issues?q=${encoded}&per_page=10`);
      if (result.items) allIssues.push(...result.items);
    }

    const seenInScan = new Set();
    for (const issue of allIssues) {
      const id = issue.id;
      seenInScan.add(id);

      if (!seen.has(id)) {
        seen.add(id);
        const bounty = parseBountyAmount(issue.title, issue.body);
        const joke = isJokeIssue(issue.title, issue.body);

        console.log(`\n${'='.repeat(60)}`);
        console.log(`NEW BOUNTY: ${issue.title}`);
        console.log(`Repo: ${issue.repository_url.split('/').slice(-2).join('/')}`);
        console.log(`URL: ${issue.html_url}`);
        console.log(`Created: ${issue.created_at}`);
        if (bounty) {
          console.log(`Value: $${bounty.usdEstimate}${joke ? ' (likely joke)' : ''}`);
        } else {
          console.log(`Value: unknown`);
        }
        if (bounty && bounty.usdEstimate >= 10 && !joke) {
          console.log(`*** HIGH PRIORITY - WORTH PURSUING ***`);
        }
        console.log(`Labels: ${issue.labels.map(l => l.name).join(', ')}`);
      }
    }

    saveSeen();

    const newCount = seenInScan.size;
    console.log(`\n[${new Date().toISOString()}] Tracked ${seen.size} total issues. Last scan: ${allIssues.length} issues.`);

  } catch (err) {
    console.error(`[${new Date().toISOString()}] Scan error: ${err.message}`);
  }
}

console.log('=== Bounty Scanner ===');
console.log(`Polling every ${POLL_INTERVAL / 1000}s. PID: ${process.pid}`);
scan();
setInterval(scan, POLL_INTERVAL);
