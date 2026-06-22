import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const npmCache = join(tmpdir(), "mar-vitest-npm-cache");
mkdirSync(npmCache, { recursive: true });

process.env.NPM_CONFIG_CACHE = process.env.NPM_CONFIG_CACHE || npmCache;
process.env.npm_config_cache = process.env.npm_config_cache || npmCache;
