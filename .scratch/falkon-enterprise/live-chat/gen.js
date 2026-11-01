const fs = require('node:fs');
const O = '/Users/aeres/Desktop/projects/falkon/.local/eval/o3';
const repos = ['openmrs-esm-patient-management','openmrs-esm-billing-app','openmrs-module-billing','openmrs-module-fhir2','openmrs-esm-form-engine-lib','openmrs-contrib-o3-docs'];
const names = repos.map(r => `github.com/openmrs/${r}`);
const config = {
  connections: Object.fromEntries(repos.map(r => [r, { type: 'git', url: `file:///repos/${r}` }])),
  contexts: { openmrs: { include: names } },
  knowledgeBase: { enabled: true, repos: names, tokenBudget: 400000, parallelism: 2 },
};
fs.writeFileSync('config.json', JSON.stringify(config, null, 2));
const environment = { DATABASE_URL: 'postgresql://falkon:falkon@postgres:5432/falkon', REDIS_URL: 'redis://redis:6379', DATA_DIR: '/data', CONFIG_PATH: '/config/config.json', ZOEKT_URL: 'http://zoekt:6070', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'safe.directory', GIT_CONFIG_VALUE_0: '*' };
const app = { image: 'falkon-live-app', pull_policy: 'never', env_file: ['/Users/aeres/Desktop/projects/falkon-v1/.env'], environment, volumes: ['data:/data', './config.json:/config/config.json:ro', ...repos.map(r => `${O}/${r}:/repos/${r}:ro`)] };
const compose = { name: 'falkon-live', services: {
  postgres: { image: 'postgres:17-alpine', environment: { POSTGRES_USER: 'falkon', POSTGRES_PASSWORD: 'falkon', POSTGRES_DB: 'falkon' }, volumes: ['pgdata:/var/lib/postgresql/data'], healthcheck: { test: ['CMD-SHELL', 'pg_isready -U falkon'], interval: '3s', retries: 30 } },
  redis: { image: 'redis:7-alpine', healthcheck: { test: ['CMD', 'redis-cli', 'ping'], interval: '3s', retries: 30 } },
  backend: { ...app, build: { context: '/Users/aeres/Desktop/projects/falkon-v1', dockerfile: 'docker/Dockerfile' }, command: ['sh', '-c', 'pnpm --filter @falkon/db push && pnpm --filter @falkon/backend start'], depends_on: { postgres: { condition: 'service_healthy' }, redis: { condition: 'service_healthy' } } },
  zoekt: { ...app, command: ['zoekt-webserver', '-index', '/data/index', '-rpc', '-listen', ':6070'], depends_on: ['backend'] },
  api: { ...app, environment: { ...environment, API_HOST: '0.0.0.0', API_ADMIN_HOST: '0.0.0.0', AUTH_MODE: 'none', ADMIN_TOKEN: '${ADMIN_TOKEN}' }, command: ['node', 'packages/api/dist/main.js'], ports: ['127.0.0.1:3601:3001', '127.0.0.1:3602:3002'], depends_on: ['backend', 'zoekt'] },
}, volumes: { pgdata: {}, data: {} } };
fs.writeFileSync('compose.json', JSON.stringify(compose, null, 2));
