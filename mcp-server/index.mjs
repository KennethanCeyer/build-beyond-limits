#!/usr/bin/env node
/**
 * Build Beyond Limits: Agentic MCP Server (stdio JSON-RPC 2.0)
 *
 * Enables Antigravity (agy) agents to:
 *  1. Discover exact Protocol v2.0 contracts, combat/parry/skill/puzzle specs & sprite coordinates
 *  2. Inspect live multiplayer world & player state on Google Cloud for real-time debugging
 *  3. Validate client WS payloads against server anti-cheat rules & diagnose connection latency
 *
 * Zero external dependencies; runs cleanly on Node.js 20+ via stdio.
 */
import readline from 'node:readline';

const SERVER_URL = (process.env.BBL_SERVER_URL || 'http://34.158.215.133:8080').replace(/\/+$/, '');

const TOOLS = [
  {
    name: 'get_protocol_contract',
    description:
      'Retrieve detailed Protocol v2.0 REST/WebSocket and BBL-BIN v1 binary wire specifications directly from the live Build Beyond Limits server (overview, handshake, binary_protocol, state_schema, events_and_telegraphs, combat_guard_parry, skills_and_tree, weapons_and_loot, bosses_and_waves, maze_puzzle, traps_and_hearts, tileset_sprites).',
    inputSchema: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          enum: [
            'overview',
            'handshake',
            'binary_protocol',
            'state_schema',
            'events_and_telegraphs',
            'combat_guard_parry',
            'skills_and_tree',
            'weapons_and_loot',
            'bosses_and_waves',
            'maze_puzzle',
            'traps_and_hearts',
            'tileset_sprites',
          ],
          description: 'Protocol topic to fetch',
        },
      },
      required: ['topic'],
    },
  },
  {
    name: 'get_asset_manifest',
    description:
      'Fetch exact sprite coordinates { x, y, w, h } and rendering anchors from the live 512x640 dungeon atlas filtered by category.',
    inputSchema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          enum: ['heroes', 'weapons', 'shields', 'monsters', 'walls', 'hearts', 'traps', 'puzzle', 'potions'],
          description: 'Asset category to inspect',
        },
      },
      required: ['category'],
    },
  },
  {
    name: 'inspect_live_world',
    description:
      'Inspect live multiplayer dungeon state on GCP: online players, active Boss Tier/HP/3m respawn countdown, PvP flag, 4-Rune Maze Puzzle gate status, and active traps/waves.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'inspect_player_state',
    description:
      'Debug a specific player in the live dungeon by codename (e.g. "Crimson-Blade-42") or token. Returns server-authoritative position, hearts, guard/parry/charge state, skillTree, inventory, and ackSeq.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Player codename or registration token' },
      },
      required: ['query'],
    },
  },
  {
    name: 'validate_client_payload',
    description:
      'Dry-run validate a candidate WebSocket JSON payload against the server Protocol v2.0 schema and anti-cheat rules before sending it.',
    inputSchema: {
      type: 'object',
      properties: {
        payload: { type: 'object', description: 'Candidate client -> server WebSocket message JSON object' },
      },
      required: ['payload'],
    },
  },
  {
    name: 'diagnose_server_health',
    description:
      'Run live HTTP health, latency, map dimensions, and tileset availability diagnostics against the Build Beyond Limits GCP server.',
    inputSchema: { type: 'object', properties: {} },
  },
];

async function fetchJson(pathname, init = {}) {
  const res = await fetch(`${SERVER_URL}${pathname}`, init);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} on ${pathname}: ${JSON.stringify(json)}`);
  }
  return json;
}

function filterSprites(sprites, category) {
  const entries = Object.entries(sprites || {});
  const matchers = {
    heroes: (k) => /^(knight_|wizzard_|elf_|dwarf_|lizard_)/.test(k),
    weapons: (k) => k.startsWith('weapon_'),
    shields: (k) => k.startsWith('shield_'),
    monsters: (k) =>
      /^(swampy|muddy|slug|tiny_zombie|imp|goblin|skelet|ice_zombie|wogol|pumpkin_dude|orc_|masked_orc|necromancer|chort|big_zombie|ogre|big_demon)/.test(
        k
      ),
    walls: (k) => k.startsWith('wh_') || k.startsWith('wall_') || k.startsWith('floor_shadow_') || k === 'column',
    hearts: (k) => k.startsWith('ui_heart_'),
    traps: (k) => k.startsWith('floor_spikes_'),
    puzzle: (k) => k.startsWith('button_') || k.startsWith('doors_'),
    potions: (k) => k.startsWith('flask_') || k.startsWith('chest_') || k.startsWith('item_') || k === 'crate',
  };
  const fn = matchers[category] || (() => true);
  return Object.fromEntries(entries.filter(([k]) => fn(k)));
}

async function callTool(name, args = {}) {
  if (name === 'get_protocol_contract') {
    const topic = encodeURIComponent(args.topic || 'overview');
    return await fetchJson(`/api/mcp/contract/${topic}`);
  }
  if (name === 'get_asset_manifest') {
    const ts = await fetchJson('/api/tileset');
    return {
      sheetUrl: `${SERVER_URL}${ts.sheetUrl}`,
      sheetWidth: ts.sheetWidth,
      sheetHeight: ts.sheetHeight,
      tileSize: ts.tileSize,
      category: args.category,
      sprites: filterSprites(ts.sprites, args.category),
      renderingHints: ts.renderingHints,
    };
  }
  if (name === 'inspect_live_world') {
    return await fetchJson('/api/mcp/world');
  }
  if (name === 'inspect_player_state') {
    const q = encodeURIComponent(args.query || '');
    const data = await fetchJson(`/api/mcp/player/${q}`);
    if (data?.privateState && 'token' in data.privateState) {
      delete data.privateState.token;
    }
    return data;
  }
  if (name === 'validate_client_payload') {
    return await fetchJson('/api/mcp/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args.payload || {}),
    });
  }
  if (name === 'diagnose_server_health') {
    const t0 = Date.now();
    const health = await fetchJson('/api/health');
    const rttMs = Date.now() - t0;
    const map = await fetchJson('/api/map');
    const ts = await fetchJson('/api/tileset');
    return {
      serverUrl: SERVER_URL,
      wsUrl: SERVER_URL.replace(/^http/i, 'ws') + '/ws',
      httpRttMs: rttMs,
      health,
      mapDimensions: `${map.width}x${map.height}`,
      zonesCount: map.zones?.length || 0,
      runePads: map.runePads?.length || 0,
      gateTiles: map.gateTiles?.length || 0,
      dartShooters: map.dartShooters?.length || 0,
      spriteCount: Object.keys(ts.sprites || {}).length,
      binaryProtocolVersion: 1,
    };
  }
  throw new Error(`Unknown tool: ${name}`);
}

function sendResponse(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}

function sendError(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n');
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on('line', async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let req;
  try {
    req = JSON.parse(trimmed);
  } catch {
    return;
  }

  const { id, method, params } = req;

  if (method === 'initialize') {
    sendResponse(id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'bbl-roguelike', version: '2.0.0' },
    });
    return;
  }

  if (method === 'notifications/initialized' || method === 'initialized') {
    return;
  }

  if (method === 'tools/list') {
    sendResponse(id, { tools: TOOLS });
    return;
  }

  if (method === 'tools/call') {
    try {
      const data = await callTool(params?.name, params?.arguments || {});
      sendResponse(id, {
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      });
    } catch (err) {
      sendResponse(id, {
        isError: true,
        content: [{ type: 'text', text: `Error calling ${params?.name}: ${err.message}` }],
      });
    }
    return;
  }

  if (id !== undefined) {
    sendError(id, -32601, `Method not found: ${method}`);
  }
});
