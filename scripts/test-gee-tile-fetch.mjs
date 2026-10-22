import assert from 'node:assert/strict';
import { fetchGeeTile, resetTileQueue, TILE_CONCURRENCY, TILE_RETRIES } from '../public/js/geeTiles.js';

const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const sleep = () => Promise.resolve();

function response(status, type = 'image/png', body = png) {
  return new Response(body, { status, headers: { 'content-type': type } });
}

resetTileQueue();
{
  let n = 0;
  const blob = await fetchGeeTile('http://tile.test/a', {
    sleep,
    fetchImpl: async () => {
      n += 1;
      return n === 1 ? response(429, 'text/plain', 'slow') : response(200);
    }
  });
  assert.equal(blob.type, 'image/png');
  assert.equal(n, 2);
}

resetTileQueue();
{
  let n = 0;
  await assert.rejects(() => fetchGeeTile('http://tile.test/b', {
    sleep,
    fetchImpl: async () => {
      n += 1;
      return response(400, 'application/json', '{"error":"expired"}');
    }
  }));
  assert.equal(n, 1);
}

resetTileQueue();
{
  let n = 0;
  const blob = await fetchGeeTile('http://tile.test/masked', {
    sleep,
    fetchImpl: async () => {
      n += 1;
      return response(400, 'application/json', '{"error":{"message":"Tile is empty or fully masked."}}');
    }
  });
  assert.equal(blob.type, 'image/png');
  assert.equal(n, 1);
}

resetTileQueue();
{
  let n = 0;
  await assert.rejects(() => fetchGeeTile('http://tile.test/c', {
    sleep,
    fetchImpl: async () => {
      n += 1;
      return response(502, 'text/plain', 'down');
    }
  }));
  assert.equal(n, TILE_RETRIES + 1);
}

resetTileQueue();
{
  let active = 0;
  let max = 0;
  const fetchImpl = async () => {
    active += 1;
    max = Math.max(max, active);
    await new Promise(resolve => setTimeout(resolve, 40));
    active -= 1;
    return response(200);
  };
  await Promise.all(Array.from({ length: 10 }, (_, i) => fetchGeeTile(`http://tile.test/${i}`, { sleep, fetchImpl })));
  assert.ok(max <= TILE_CONCURRENCY, `concurrency ${max}`);
  assert.ok(max >= 2);
}

console.log('test-gee-tile-fetch ok');
