const fs = require('fs');
const path = require('path');

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m'
};

const log = (message, color = colors.reset) => {
  console.log(`${color}${message}${colors.reset}`);
};

const checkRequirements = () => {
  log('\n🔍 Checking System Requirements...', colors.cyan);
  
  // Check Node.js version
  const nodeVersion = process.version;
  log(`Node.js: ${nodeVersion}`, colors.green);
  
  // Check if package.json exists
  const packageJsonPath = path.join(__dirname, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    log('✅ package.json found', colors.green);
  } else {
    log('❌ package.json not found', colors.red);
    return false;
  }
  
  // Check if node_modules exists
  const nodeModulesPath = path.join(__dirname, 'node_modules');
  if (fs.existsSync(nodeModulesPath)) {
    log('✅ Dependencies installed', colors.green);
  } else {
    log('❌ Dependencies not installed. Run: npm install', colors.red);
    return false;
  }
  
  return true;
};

const checkEnvironment = () => {
  log('\n🔧 Environment Configuration...', colors.cyan);
  
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    log('✅ .env file found', colors.green);
  } else {
    log('⚠️  .env file not found. Copy from .env.example', colors.yellow);
    log('   Required variables:', colors.yellow);
    log('   - MONGODB_URI', colors.yellow);
    log('   - REDIS_URL', colors.yellow);
    log('   - TMDB_API_KEY', colors.yellow);
  }
  
  // Check critical environment variables
  const requiredVars = ['MONGODB_URI', 'REDIS_URL'];
  requiredVars.forEach(variable => {
    if (process.env[variable]) {
      log(`✅ ${variable} configured`, colors.green);
    } else {
      log(`⚠️  ${variable} not set`, colors.yellow);
    }
  });
};

const printWelcome = () => {
  log('\n' + '='.repeat(60), colors.magenta);
  log('🎬 CineMatch AI - Movie Recommendation System', colors.bold + colors.magenta);
  log('='.repeat(60), colors.magenta);
  
  log('\n🚀 Features Implemented:', colors.cyan);
  log('  • Hybrid ML Recommendation Engine', colors.green);
  log('  • Real-time User Action Tracking', colors.green);
  log('  • Matrix Factorization with TensorFlow.js', colors.green);
  log('  • Redis Caching & Performance Optimization', colors.green);
  log('  • MongoDB User Profile Analytics', colors.green);
  log('  • RESTful API with Comprehensive Endpoints', colors.green);
  
  log('\n📊 System Architecture:', colors.cyan);
  log('  • Backend: Node.js + Express + MongoDB + Redis', colors.blue);
  log('  • ML Engine: TensorFlow.js + Matrix Factorization', colors.blue);
  log('  • Frontend: React + TypeScript + Vite + Tailwind', colors.blue);
  log('  • Caching: Multi-level (Redis + Browser)', colors.blue);
};

const printAPIEndpoints = () => {
  log('\n🔗 Available API Endpoints:', colors.cyan);
  
  const endpoints = [
    { method: 'GET', path: '/api/recommendations/:userId', desc: 'Get personalized recommendations' },
    { method: 'POST', path: '/api/track-action', desc: 'Record user actions' },
    { method: 'GET', path: '/api/user-profile/:userId', desc: 'Get user profile & stats' },
    { method: 'GET', path: '/api/user-actions/:userId', desc: 'Get user action history' },
    { method: 'GET', path: '/api/stats/recommendations', desc: 'Get system statistics' },
    { method: 'GET', path: '/api/health', desc: 'Health check endpoint' },
    { method: 'POST', path: '/api/ml/train', desc: 'Trigger model training' }
  ];
  
  endpoints.forEach(endpoint => {
    const methodColor = endpoint.method === 'GET' ? colors.green : colors.yellow;
    log(`  ${methodColor}${endpoint.method.padEnd(4)}${colors.reset} ${endpoint.path.padEnd(35)} - ${endpoint.desc}`, colors.blue);
  });
};

const printStartupCommands = () => {
  log('\n🎯 Quick Start Commands:', colors.cyan);
  log('  Development:', colors.green);
  log('    npm run dev                    # Start backend with nodemon', colors.blue);
  log('    cd .. && npm run dev           # Start frontend (from root)', colors.blue);
  
  log('\n  Production:', colors.green);
  log('    npm start                      # Start backend', colors.blue);
  log('    cd .. && npm run build         # Build frontend', colors.blue);
  
  log('\n  Testing:', colors.green);
  log('    npm test                       # Run all tests', colors.blue);
  log('    npm run test:recommendation-engine    # Test ML engine', colors.blue);
  
  log('\n  Database Setup:', colors.green);
  log('    # Start MongoDB (if not running)', colors.blue);
  log('    mongod --dbpath /data/db', colors.blue);
  log('    # Start Redis (if not running)', colors.blue);
  log('    redis-server', colors.blue);
};

const printExampleUsage = () => {
  log('\n📝 Example API Usage:', colors.cyan);
  
  const examples = [
    {
      title: 'Get Recommendations',
      curl: 'curl http://localhost:4000/api/recommendations/user123?count=10'
    },
    {
      title: 'Track User Rating',
      curl: `curl -X POST http://localhost:4000/api/track-action \\
  -H "Content-Type: application/json" \\
  -d '{"userId":"user123","movieId":550,"actionType":"rate","value":8}'`
    },
    {
      title: 'Get User Profile',
      curl: 'curl http://localhost:4000/api/user-profile/user123'
    }
  ];
  
  examples.forEach(example => {
    log(`  ${example.title}:`, colors.green);
    log(`    ${example.curl}`, colors.blue);
    log('');
  });
};

const main = () => {
  printWelcome();
  
  if (!checkRequirements()) {
    log('\n❌ System requirements not met. Please install dependencies first.', colors.red);
    process.exit(1);
  }
  
  checkEnvironment();
  printAPIEndpoints();
  printStartupCommands();
  printExampleUsage();
  
  log('\n🔗 Useful Links:', colors.cyan);
  log('  • Backend API: http://localhost:4000', colors.blue);
  log('  • Frontend: http://localhost:5173 (when running)', colors.blue);
  log('  • Health Check: http://localhost:4000/api/health', colors.blue);
  log('  • Documentation: See CineMatch_Implementation_Summary.md', colors.blue);
  
  log('\n💡 Pro Tips:', colors.cyan);
  log('  • Use /api/health to verify all services are running', colors.yellow);
  log('  • Monitor logs for recommendation accuracy improvements', colors.yellow);
  log('  • Check Redis cache hit rates in /api/stats/recommendations', colors.yellow);
  log('  • The system learns and improves with each user interaction', colors.yellow);
  
  log('\n🎉 Ready to start your movie recommendation journey!', colors.bold + colors.green);
  log('=' * 60 + '\n', colors.magenta);
};

// Run the startup script
main();