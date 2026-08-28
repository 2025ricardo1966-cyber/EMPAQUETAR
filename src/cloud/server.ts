import { bootControlPlane } from './kernel';
import { loadControlPlaneEnv } from './env';

async function main(): Promise<void> {
  const env = loadControlPlaneEnv();
  const kernel = await bootControlPlane({ env, listen: true });
  process.stdout.write(
    `${JSON.stringify({ event: 'control-plane.listening', url: kernel.url, env: env.name, dataDir: env.dataDir, ephemeral: env.dataEphemeral, backup: env.backupStrategy })}\n`
  );
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
