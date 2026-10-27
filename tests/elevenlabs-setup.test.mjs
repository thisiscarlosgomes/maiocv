import test from 'node:test';
import assert from 'node:assert/strict';
import { main, reviewTools, agentConfig, serverConfig, verifyAgent } from '../scripts/setup-elevenlabs.mjs';

const inputSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object', properties: {}, additionalProperties: false,
};
// Two reviewed, real public tool definitions; no account, network or .env required.
const liveTools = [
  { name: 'get_maio_weather', description: 'Returns current weather and the available daily forecast for Maio, including temperature, humidity, precipitation, weather code, and daily minimum/maximum temperatures.', inputSchema },
  { name: 'get_codigo_postura_stats', description: 'Returns loaded legal corpus coverage and document/article counts.', inputSchema },
];

function harness(t, { enabled = true, agents = [], servers = [] } = {}) {
  const previousKey = process.env.ELEVENLABS_API_KEY;
  const previousVoice = process.env.ELEVENLABS_VOICE_ID;
  process.env.ELEVENLABS_API_KEY = 'test-key-never-sent-to-a-real-service';
  delete process.env.ELEVENLABS_VOICE_ID;
  t.after(() => {
    if (previousKey === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = previousKey;
    if (previousVoice === undefined) delete process.env.ELEVENLABS_VOICE_ID;
    else process.env.ELEVENLABS_VOICE_ID = previousVoice;
  });
  t.mock.method(process, 'loadEnvFile', () => {});
  t.mock.method(console, 'log', () => {});
  const calls = [];
  const approved = new Set();
  let savedAgent = agents[0];
  let savedServer = servers[0];
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    const u = new URL(url);
    const method = options.method ?? 'GET';
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ path: u.pathname, method, body });
    let result;
    if (u.hostname === 'portal.maio.cv') {
      assert.ok(['initialize', 'notifications/initialized', 'tools/list'].includes(body.method), 'setup only discovers MCP tools');
      if (body.method === 'notifications/initialized') return new Response(null, { status: 202 });
      result = { jsonrpc: '2.0', id: body.id, result: body.method === 'tools/list'
        ? { tools: liveTools }
        : { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'Maio', version: '1' } } };
    } else if (u.pathname === '/v1/convai/settings') result = { can_use_mcp_servers: enabled };
    else if (u.pathname === '/v1/convai/agents' && method === 'GET') result = { agents, has_more: false };
    else if (u.pathname === '/v2/voices') result = { voices: [{ voice_id: 'river', name: 'River', category: 'premade', labels: { use_case: 'conversational' }, verified_languages: ['pt', 'en', 'fr'].map(language => ({ language })) }], has_more: false };
    else if (u.pathname === '/v1/voices/river') result = { voice_id: 'river', name: 'River' };
    else if (u.pathname === '/v1/convai/mcp-servers' && method === 'GET') result = { mcp_servers: servers };
    else if (u.pathname === '/v1/convai/mcp-servers' && method === 'POST') {
      savedServer = { id: 'mcp1', config: body.config };
      servers.push(savedServer);
      result = savedServer;
    } else if (u.pathname === '/v1/convai/mcp-servers/mcp1' && method === 'GET') result = savedServer;
    else if (u.pathname === '/v1/convai/mcp-servers/mcp1' && method === 'PATCH') {
      Object.assign(savedServer.config, body);
      result = savedServer;
    } else if (u.pathname === '/v1/convai/mcp-servers/mcp1/tools') {
      result = { success: true, tools: liveTools, tool_approval_statuses: [...approved].map(name => ({ tool_id: `mcp:mcp1:${name}`, state: 'up_to_date', approval_policy: 'auto_approved' })) };
    } else if (u.pathname === '/v1/convai/mcp-servers/mcp1/tool-approvals' && method === 'POST') {
      assert.ok(liveTools.some(tool => tool.name === body.tool_name));
      approved.add(body.tool_name);
      savedServer.config.tool_approval_hashes.push({ tool_name: body.tool_name, approval_policy: 'auto_approved', tool_hash: 'known' });
      result = {};
    } else if (u.pathname === '/v1/convai/agents/create' && method === 'POST') {
      savedAgent = { agent_id: 'agent1', ...structuredClone(body) };
      // Observed provider behavior: inline client-tool migration initially drops
      // built-ins, then GET duplicates configured built-ins in legacy tools.
      savedAgent.conversation_config.agent.prompt.built_in_tools = { end_call: null };
      agents.push(savedAgent);
      savedServer.dependent_agents = [{ id: 'agent1', type: 'available' }];
      result = { agent_id: 'agent1' };
    } else if (u.pathname === '/v1/convai/agents/agent1' && method === 'PATCH') {
      assert.deepEqual(Object.keys(body), ['conversation_config']);
      const builtIns = body.conversation_config.agent.prompt.built_in_tools;
      savedAgent.conversation_config.agent.prompt.built_in_tools = builtIns;
      savedAgent.conversation_config.agent.prompt.tools.push(builtIns.end_call);
      result = savedAgent;
    } else if (u.pathname === '/v1/convai/agents/agent1') result = savedAgent;
    else throw new Error(`Unexpected mocked request ${method} ${u.pathname}`);
    return Response.json(result);
  });
  return { calls, agents, servers, approved, writes: () => calls.filter(call => call.path.startsWith('/v1/convai') && call.method !== 'GET') };
}

test('unknown names and changed tool definitions are excluded', () => {
  const unknown = { name: 'delete_all', description: 'write', inputSchema };
  const changed = { ...liveTools[0], description: 'changed' };
  const review = reviewTools([changed, liveTools[1], unknown]);
  assert.deepEqual(review.approved.map(tool => tool.name), ['get_codigo_postura_stats']);
  assert.equal(review.excluded.length, 2);
  assert.throws(() => reviewTools([unknown]), /No live MCP tools match/);
});

test('dry-run performs no provider mutations', async t => {
  const state = harness(t);
  await main(['--dry-run']);
  assert.equal(state.writes().length, 0);
});

test('provisioning creates a private token-authenticated agent without a provider host allowlist', async t => {
  const state = harness(t);
  await main(['--apply']);
  const created = state.calls.find(call => call.path === '/v1/convai/agents/create' && call.method === 'POST');
  const auth = { enable_auth: true, allowlist: [], require_origin_header: false };
  assert.deepEqual(created?.body.platform_settings.auth, auth);
  assert.deepEqual(state.agents[0].platform_settings.auth, auth);
});

test('legacy combined token auth and host allowlisting blocks reuse without rewriting resources', async t => {
  const agent = { agent_id: 'agent1', ...agentConfig('mcp1', 'river') };
  agent.platform_settings.auth = {
    enable_auth: true,
    allowlist: ['localhost', '127.0.0.1', 'maio.cv', 'www.maio.cv'].map(hostname => ({ hostname })),
    require_origin_header: true,
  };
  const previous = structuredClone(agent);
  const state = harness(t, { agents: [agent], servers: [{ id: 'mcp1', config: serverConfig() }] });
  await assert.rejects(() => main(['--apply']), /differs at agent\.platform_settings\.auth\.allowlist/);
  assert.equal(state.writes().length, 0);
  assert.deepEqual(state.agents[0], previous);
});

test('disabled workspace MCP blocks apply before mutations', async t => {
  const state = harness(t, { enabled: false });
  await assert.rejects(() => main(['--apply']), /MCP is disabled/);
  assert.equal(state.writes().length, 0);
});

test('ambiguous agent names block apply before mutations', async t => {
  const agent = { agent_id: 'agent1', ...agentConfig('mcp1', 'river') };
  const state = harness(t, { agents: [agent, structuredClone(agent)] });
  await assert.rejects(() => main(['--apply']), /Multiple agent/);
  assert.equal(state.writes().length, 0);
});

test('unrelated agents with matching names are never overwritten', async t => {
  const agent = { agent_id: 'agent1', ...agentConfig('mcp1', 'river'), tags: [] };
  const state = harness(t, { agents: [agent] });
  await assert.rejects(() => main(['--apply']), /unrelated agent/);
  assert.equal(state.writes().length, 0);
});

test('adopts the user-created integration without duplication or broader permissions', async t => {
  const config = { ...serverConfig(), name: 'Maio Open Data', description: 'User created', approval_policy: 'require_approval_all', response_timeout_secs: 60 };
  const state = harness(t, { servers: [{ id: 'mcp1', config }] });
  await main(['--apply']);
  assert.equal(state.servers.length, 1);
  assert.equal(state.agents.length, 1);
  assert.equal(state.servers[0].config.approval_policy, 'require_approval_per_tool');
  assert.equal(state.servers[0].config.response_timeout_secs, 15);
  assert.equal(state.approved.size, 2);
});

test('repeat apply reuses the same resources, approvals and normalized system tool', async t => {
  const state = harness(t);
  await main(['--apply']);
  assert.equal(state.agents.length, 1);
  assert.equal(state.servers.length, 1);
  assert.equal(state.approved.size, 2);
  const writes = state.writes().length;
  await main(['--apply']);
  assert.equal(state.writes().length, writes);
  verifyAgent(state.agents[0], agentConfig('mcp1', 'river'));
  const unsafe = structuredClone(state.agents[0]);
  unsafe.conversation_config.agent.prompt.tools.push({ type: 'system', name: 'transfer_to_number' });
  assert.throws(() => verifyAgent(unsafe, agentConfig('mcp1', 'river')), /unexpected system tool/);
});
