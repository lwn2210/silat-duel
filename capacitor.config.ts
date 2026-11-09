import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'id.morfotech.silatduel',
  appName: 'Silat Duel',
  webDir: 'dist',
  backgroundColor: '#2b1a14',
  plugins: {
    // Full screen: status and navigation bars hidden (a swipe brings them back for a moment).
    SystemBars: { hidden: true, insetsHandling: 'css', initialViewportFitValueHint: 'cover' },
  },
}

export default config
