import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'./tests/ui',testMatch:'catalyst-reports.spec.ts',workers:1,fullyParallel:false,
  outputDir:'output/playwright/catalysts',reporter:'list',
  use:{baseURL:'http://127.0.0.1:3018',viewport:{width:1440,height:900},trace:'retain-on-failure'},
  webServer:{
    command:'node scripts/next-dev.mjs --hostname 127.0.0.1 --port 3018',
    url:'http://127.0.0.1:3018/?demo=1',
    reuseExistingServer:false,
    env:{...process.env,NEXT_PUBLIC_SUPABASE_URL:'https://catalyst-fixture.supabase.co',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture_only',BRONTIDE_LOCAL_BUILD:''},
  },
});
