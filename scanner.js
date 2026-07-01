const https = require('https');
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.GH_TOKEN;
const SEEN_FILE = path.join(__dirname, 'seen.json');
const LOG_FILE = path.join(__dirname, 'bounties.log');
const POLL_INTERVAL = 5 * 60 * 1000;

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

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
    log('Scanning for new bounty issues...');

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

        const repo = issue.repository_url.split('/').slice(-2).join('/');
        const value = bounty ? `$${bounty.usdEstimate}${joke ? ' (joke)' : ''}` : 'unknown';
        const priority = bounty && bounty.usdEstimate >= 10 && !joke ? ' ★ HIGH PRIORITY' : '';

        log(`NEW: ${issue.title}`);
        log(`Repo: ${repo} | Value: ${value}${priority}`);
        log(`URL: ${issue.html_url}`);

        console.log(`\n${'='.repeat(60)}`);
        console.log(`NEW BOUNTY: ${issue.title}`);
        console.log(`Repo: ${repo}`);
        console.log(`URL: ${issue.html_url}`);
        console.log(`Created: ${issue.created_at}`);
        console.log(`Value: ${value}${priority}`);
        console.log(`Labels: ${issue.labels.map(l => l.name).join(', ')}`);
      }
    }

    saveSeen();

    log(`Tracked ${seen.size} total issues. Last scan: ${allIssues.length} issues.`);

  } catch (err) {
    console.error(`[${new Date().toISOString()}] Scan error: ${err.message}`);
  }
}

log('=== Bounty Scanner Started ===');
log(`Polling every ${POLL_INTERVAL / 1000}s. PID: ${process.pid}`);
log(`Log file: ${LOG_FILE}`);
scan();
setInterval(scan, POLL_INTERVAL);
