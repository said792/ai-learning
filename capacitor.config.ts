import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.nexora.soft.learn",
  appName: "Nexora Learn",
  webDir: "public",

  server: {
    url: "https://ai-learning-sandy.vercel.app/",
    cleartext: false,
  },
};

export default config;