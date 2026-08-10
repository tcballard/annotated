import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(projectRoot, 'config/capabilities.json');
const releasePath = path.join(projectRoot, 'dist/release/release.json');

export const proofWorldStatus = (store = {}) => {
  const users = (store.users || []).filter((item) => item.isDemo || item.provider === 'demo');
  const annotations = (store.annotations || []).filter((item) => item.isDemo && item.status === 'published');
  const required = {
    labelledDemoUsers: users.length >= 4,
    article: annotations.some((item) => item.sourceType === 'article'),
    video: annotations.some((item) => item.sourceType === 'video' && item.mediaStatus === 'ready' && item.mediaAssetId),
    podcast: annotations.some((item) => item.sourceType === 'podcast' && item.mediaStatus === 'ready' && item.mediaAssetId),
    screenshot: annotations.some((item) => item.screenshotAssetId),
    audioCommentary: annotations.some((item) => item.audioAssetId || item.commentaryMode === 'audio'),
    responses: (store.comments || []).some((item) => annotations.some((annotation) => annotation.id === item.annotationId)),
    socialGraph: (store.follows || []).length > 0 && (store.likes || []).length > 0,
    demonstrationClaim: (store.claims || []).some((item) => item.isDemo),
  };
  const missing = Object.entries(required).filter(([, value]) => !value).map(([key]) => key);
  return { ready: missing.length === 0, label: 'Demonstration data — not real user activity', counts: { users: users.length, annotations: annotations.length }, required, missing };
};

const readOptionalJson = async (filePath) => {
  try { return JSON.parse(await readFile(filePath, 'utf8')); } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
};

export const getCapabilities = async ({ publicOrigin, releaseVersion, providers, store }) => {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.capabilities)) throw new Error('Unsupported capability manifest.');
  const artifact = await readOptionalJson(releasePath);
  const canonical = new URL(publicOrigin).origin === new URL(manifest.canonicalOrigin).origin;
  const gitSha = process.env.RAILWAY_GIT_COMMIT_SHA || process.env.GIT_COMMIT || process.env.GITHUB_SHA || artifact?.gitSha || null;
  const environment = process.env.ANNOTATED_ENVIRONMENT || process.env.RAILWAY_ENVIRONMENT_NAME || process.env.NODE_ENV || 'development';
  return {
    schemaVersion: manifest.schemaVersion,
    canonicalOrigin: manifest.canonicalOrigin,
    isCanonicalDeployment: canonical,
    release: { version: releaseVersion, gitSha, environment, deployedAt: process.env.ANNOTATED_DEPLOYED_AT || artifact?.builtAt || null },
    providers,
    distribution: {
      store: manifest.distribution.store,
      directArtifact: artifact ? { ...manifest.distribution.directArtifact, available: true, version: artifact.version, sha256: artifact.sha256, bytes: artifact.bytes } : { ...manifest.distribution.directArtifact, available: false },
    },
    proofWorld: proofWorldStatus(store),
    capabilities: manifest.capabilities.map((item) => ({ ...item, verifiedAt: item.verifiedAt || manifest.reviewedAt, deployed: canonical && item.stagingDeployed, providerVerified: item.id === 'oauth' ? Object.keys(providers || {}).length > 0 && Object.values(providers).every(Boolean) : Boolean(item.providerVerified) })),
  };
};
