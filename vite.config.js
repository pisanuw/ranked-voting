import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { publicEnvProblems } from './public-env.js'

export default defineConfig(({ command, mode }) => {
  // On Netlify, refuse to build against anything but the shared HintWise project's public
  // values (public-env.js). Local builds and tests may use their own .env.
  if (command === 'build' && process.env.NETLIFY === 'true') {
    const problems = publicEnvProblems(loadEnv(mode, process.cwd(), 'VITE_'))
    if (problems.length) throw new Error(`RankedVote build stopped:\n- ${problems.join('\n- ')}`)
  }
  return {
    plugins: [react()],
    test: {
      // Tests never reach a Supabase project: they pass fakes. Blank the public values so a
      // developer's shell or .env cannot leak into them (src/lib/supabase.ts reads them).
      env: { VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' },
    },
  }
})
