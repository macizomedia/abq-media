import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import http from 'node:http';

const CLI = path.resolve(import.meta.dirname, '../src/cli.js');
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'abq-smoke-'));

test('doctor returns valid JSON', () => {
  const out = execSync(`node ${CLI} doctor`, { cwd, encoding: 'utf8' });
  const json = JSON.parse(out);
  assert.ok(json.ok !== undefined);
});

test('prep with --text creates output artifacts', () => {
  const text = 'Este es un texto de prueba con suficiente contenido para pasar la verificación de longitud mínima. El video habla sobre geopolítica, minerales raros, y la transición venezolana hacia la democracia.';
  execSync(`node ${CLI} prep --text "${text}"`, { cwd, encoding: 'utf8' });
  const outDir = path.join(cwd, 'output');
  const runs = fs.readdirSync(outDir).filter(d => d.startsWith('prep-'));
  assert.ok(runs.length > 0, 'Should have prep output dir');
  const run = path.join(outDir, runs[0]);
  assert.ok(fs.existsSync(path.join(run, 'metadata.json')));
  assert.ok(fs.existsSync(path.join(run, 'digest.md')));
  assert.ok(fs.existsSync(path.join(run, 'deep_research_prompt.md')));
});

test('prep with --transcript-file creates output artifacts', () => {
  const tmpTxt = path.join(cwd, 'test-transcript.txt');
  fs.writeFileSync(tmpTxt, 'Transcript content about Venezuela mineral policy and geopolitical transitions in Latin America. The rare earth minerals sector is experiencing significant shifts as the United States and China compete for access to lithium and coltan deposits in the region.');
  execSync(`node ${CLI} prep --transcript-file test-transcript.txt`, { cwd, encoding: 'utf8' });
  const outDir = path.join(cwd, 'output');
  const runs = fs.readdirSync(outDir).filter(d => d.startsWith('prep-'));
  assert.ok(runs.length > 0);
});

test('latest returns a path after prep runs', () => {
  const out = execSync(`node ${CLI} latest`, { cwd, encoding: 'utf8' }).trim();
  assert.ok(out.length > 0, 'Should return a path');
  assert.ok(fs.existsSync(out), 'Returned path should exist');
});

test('prep fails when audio file is missing', () => {
  try {
    execSync(`node ${CLI} prep --audio-file missing.mp3`, { cwd, encoding: 'utf8', stdio: 'pipe' });
    assert.fail('Expected prep to fail for missing audio file');
  } catch (err) {
    const stderr = String(err?.stderr || '');
    assert.match(stderr, /Audio file not found/i);
  }
});

test('prep with --use-asr fails without ASR config', () => {
  const url = 'https://youtu.be/dQw4w9WgXcQ';
  try {
    execSync(`node ${CLI} prep --url ${url} --use-asr true`, { cwd, encoding: 'utf8', stdio: 'pipe' });
    assert.fail('Expected prep to fail when ASR is not configured');
  } catch (err) {
    const stderr = String(err?.stderr || '');
    assert.match(stderr, /ASR not configured/i);
  }
});

test('prep rejects conflicting flags', () => {
  const url = 'https://youtu.be/dQw4w9WgXcQ';
  try {
    execSync(`node ${CLI} prep --url ${url} --use-asr true --use-captions true`, { cwd, encoding: 'utf8', stdio: 'pipe' });
    assert.fail('Expected prep to fail for conflicting flags');
  } catch (err) {
    const stderr = String(err?.stderr || '');
    assert.match(stderr, /cannot be used together/i);
  }
});

test('publish without llmProvider fails with clear error', () => {
  const input = path.join(cwd, 'deep_research_prompt.md');
  fs.writeFileSync(input, '# Deep Research Brief\n\nContenido de prueba.\n');
  try {
    execSync(`node ${CLI} publish --input deep_research_prompt.md`, { cwd, encoding: 'utf8', stdio: 'pipe' });
    assert.fail('Expected publish to fail without llmProvider');
  } catch (err) {
    const stderr = String(err?.stderr || '');
    assert.match(stderr, /LLM provider not configured/i);
  }
});

test('publish fails when input file is missing', () => {
  try {
    execSync(`node ${CLI} publish --input missing.md`, { cwd, encoding: 'utf8', stdio: 'pipe' });
    assert.fail('Expected publish to fail for missing input');
  } catch (err) {
    const stderr = String(err?.stderr || '');
    assert.match(stderr, /Input file not found/i);
  }
});

const runPublishMock = process.env.ABQ_RUN_PUBLISH_MOCK === '1';

(runPublishMock ? test : test.skip)('publish succeeds with mocked LLM endpoint', async () => {
  const prompt = path.join(cwd, 'deep_research_prompt.md');
  fs.writeFileSync(prompt, '# Deep Research Brief\n\nContenido de prueba.\n');

  const sockets = new Set();
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/chat/completions') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json', connection: 'close' });
        res.end(JSON.stringify({ choices: [{ message: { content: 'OK mock output' } }] }));
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.unref();
    socket.on('close', () => sockets.delete(socket));
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  server.unref();
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    execSync(`node ${CLI} prep --text \"Texto suficientemente largo para crear un prompt de investigación que luego se use con --latest en publish.\"`, { cwd, encoding: 'utf8' });
    const configPath = path.join(cwd, '.abq-module.json');
    fs.writeFileSync(configPath, JSON.stringify({
      llmProvider: 'openai',
      llmApiKey: 'test-key',
      baseUrl
    }, null, 2));

    execSync(`node ${CLI} publish --latest`, { cwd, encoding: 'utf8', timeout: 10000 });

    const outDir = path.join(cwd, 'output');
    const runs = fs.readdirSync(outDir).filter(d => d.startsWith('publish-'));
    assert.ok(runs.length > 0, 'Should have publish output dir');
    const run = path.join(outDir, runs[0]);
    assert.ok(fs.existsSync(path.join(run, 'metadata.json')));
    assert.ok(fs.existsSync(path.join(run, 'podcast_script.md')));
    assert.ok(fs.existsSync(path.join(run, 'article.md')));
    assert.ok(fs.existsSync(path.join(run, 'reel_script.md')));
    assert.ok(fs.existsSync(path.join(run, 'social_posts.md')));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    for (const socket of sockets) {
      socket.destroy();
    }
  }
});
test('publish without llmProvider fails with clear error', () => {
  const input = path.join(cwd, 'deep_research_prompt.md');
  fs.writeFileSync(input, '# Deep Research Brief\n\nContenido de prueba.\n');
  try {
    execSync(`node ${CLI} publish --input deep_research_prompt.md`, { cwd, encoding: 'utf8', stdio: 'pipe' });
    assert.fail('Expected publish to fail without llmProvider');
  } catch (err) {
    const stderr = String(err?.stderr || '');
    assert.match(stderr, /LLM provider not configured/i);
  }
});

test('publish fails when input file is missing', () => {
  try {
    execSync(`node ${CLI} publish --input missing.md`, { cwd, encoding: 'utf8', stdio: 'pipe' });
    assert.fail('Expected publish to fail for missing input');
  } catch (err) {
    const stderr = String(err?.stderr || '');
    assert.match(stderr, /Input file not found/i);
  }
});

test('publish succeeds with mocked LLM endpoint', async () => {
  const prompt = path.join(cwd, 'deep_research_prompt.md');
  fs.writeFileSync(prompt, '# Deep Research Brief\n\nContenido de prueba.\n');

  const sockets = new Set();
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/chat/completions') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json', connection: 'close' });
        res.end(JSON.stringify({ choices: [{ message: { content: 'OK mock output' } }] }));
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const configPath = path.join(cwd, '.abq-module.json');
    fs.writeFileSync(configPath, JSON.stringify({
      llmProvider: 'openai',
      llmApiKey: 'test-key',
      baseUrl
    }, null, 2));

    execSync(`node ${CLI} publish --input deep_research_prompt.md`, { cwd, encoding: 'utf8' });

    const outDir = path.join(cwd, 'output');
    const runs = fs.readdirSync(outDir).filter(d => d.startsWith('publish-'));
    assert.ok(runs.length > 0, 'Should have publish output dir');
    const run = path.join(outDir, runs[0]);
    assert.ok(fs.existsSync(path.join(run, 'metadata.json')));
    assert.ok(fs.existsSync(path.join(run, 'podcast_script.md')));
    assert.ok(fs.existsSync(path.join(run, 'article.md')));
    assert.ok(fs.existsSync(path.join(run, 'reel_script.md')));
    assert.ok(fs.existsSync(path.join(run, 'social_posts.md')));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    for (const socket of sockets) {
      socket.destroy();
    }
  }
});
