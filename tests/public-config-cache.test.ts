import {
  clearPublicConfigCacheForTests,
  getPublicConfigCached,
  invalidatePublicConfigCache,
} from "../src/lib/public-config-cache";

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error("✗ " + message);
  }
}

clearPublicConfigCacheForTests();

let loads = 0;
const loader = async () => {
  loads++;
  await new Promise((resolve) => setTimeout(resolve, 15));
  return { value: loads };
};

const [first, second] = await Promise.all([
  getPublicConfigCached("test:config", 1_000, loader),
  getPublicConfigCached("test:config", 1_000, loader),
]);

assert(loads === 1, "deduplicates concurrent cache misses");
assert(first.value === 1 && second.value === 1, "concurrent callers receive the same loaded value");

const cached = await getPublicConfigCached("test:config", 1_000, loader);
assert(loads === 1 && cached.value === 1, "serves a warm value without calling the loader again");

invalidatePublicConfigCache("test:config");
const refreshed = await getPublicConfigCached("test:config", 1_000, loader);
assert(loads === 2 && refreshed.value === 2, "invalidation forces the next request to refresh");

clearPublicConfigCacheForTests();
let expiringLoads = 0;
const expiringLoader = async () => ({ value: ++expiringLoads });
await getPublicConfigCached("test:expiry", 5, expiringLoader);
await new Promise((resolve) => setTimeout(resolve, 15));
await getPublicConfigCached("test:expiry", 5, expiringLoader);
assert(expiringLoads === 2, "expired entries refresh automatically");

console.log(`public-config-cache: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
